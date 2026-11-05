import type { SecretBox } from '../crypto/secrets.ts';
import type { Db } from '../db/client.ts';
import { insertAuditLog } from '../db/queries/audit-logs.ts';
import { type ConnectorRow, setConnectorHealth } from '../db/queries/connectors.ts';
import { type EndpointRow, touchLastCalled } from '../db/queries/endpoints.ts';
import { errorResponse, isRequest, type JsonRpcResponse, RPC_ERROR } from '../mcp/jsonrpc.ts';
import { rewriteSse } from '../mcp/sse.ts';
import {
  createResponseTap,
  planInbound,
  type ToolCallOutcome,
  toolCallNames,
} from '../mcp/tool-policy.ts';
import { type Runtimes, runtimeFor } from '../runtimes/index.ts';
import { UpstreamError, type UpstreamErrorKind } from '../upstream/safe-fetch.ts';
import { loadCredentials } from './credentials.ts';

// /c/{id}/mcp 요청 하나를 업스트림에 중계한다 (F-EP-02, F-RUN-01·03, F-UI-03).
// 허용목록·감사 로그·오류 정리는 여기서, 업스트림 전송은 런타임이 맡는다

export type McpProxyDeps = {
  db: Db;
  secrets: SecretBox;
  runtimes: Runtimes;
  publicBaseUrl: string;
  // 로그에는 분류값만 남긴다
  log: { warn: (fields: Record<string, unknown>, message: string) => void };
};

// JSON으로 읽지 못한 본문은 json이 undefined
export type McpRequestBody = { raw: string; json: unknown };

export type McpHttpRequest = {
  method: 'GET' | 'POST' | 'DELETE';
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: McpRequestBody | undefined;
  signal: AbortSignal;
};

export type McpHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: string | ReadableStream<Uint8Array> | null;
};

// 클라이언트 ↔ 업스트림 사이에 넘기는 헤더. Authorization·Cookie 등은 넘기지 않는다
const REQUEST_HEADERS = [
  'accept',
  'content-type',
  'mcp-session-id',
  'mcp-protocol-version',
  'last-event-id',
];
const RESPONSE_HEADERS = ['content-type', 'mcp-session-id'];

const LAST_CALLED_INTERVAL_MS = 60_000;

type FailureKind = UpstreamErrorKind | 'auth_failed' | 'upstream_error';

function pickHeaders(
  source: (name: string) => string | string[] | null | undefined,
  names: readonly string[],
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of names) {
    const value = source(name);
    if (value === null || value === undefined) continue;
    picked[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return picked;
}

function jsonReply(status: number, body: JsonRpcResponse | JsonRpcResponse[]): McpHttpResponse {
  return { status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

// 스트림이 끝나거나 취소될 때 한 번 알린다. 청크는 받는 대로 넘긴다
function onSettled(
  stream: ReadableStream<Uint8Array>,
  settle: () => void,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          settle();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        settle();
        controller.error(error);
      }
    },
    async cancel(reason) {
      settle();
      await reader.cancel(reason);
    },
  });
}

export function createMcpProxy(deps: McpProxyDeps) {
  function adminUrl(endpointId: string): string {
    return new URL(`/admin/endpoints/${endpointId}`, deps.publicBaseUrl).toString();
  }

  // 업스트림 원문 대신 고정 문구만 준다. 고칠 수 있는 문제면 관리 UI 링크를 붙인다 (F-RUN-03)
  function failureMessage(kind: FailureKind, endpointId: string): string {
    const fix = `관리 화면에서 커넥터 설정을 확인하세요: ${adminUrl(endpointId)}`;
    switch (kind) {
      case 'auth_failed':
        return `커넥터가 업스트림 인증에 실패했습니다. ${fix}`;
      case 'blocked_address':
      case 'insecure_scheme':
        return `커넥터 주소가 허용되지 않는 주소입니다. ${fix}`;
      case 'redirect':
        return `커넥터가 다른 주소로 보냈습니다. ${fix}`;
      case 'timeout':
        return '커넥터 응답이 너무 늦습니다. 잠시 후 다시 시도하세요.';
      case 'unreachable':
        return `커넥터에 연결하지 못했습니다. ${fix}`;
      case 'upstream_error':
        return '커넥터가 요청을 처리하지 못했습니다.';
    }
  }

  // 요청이 있으면 요청마다 JSON-RPC 오류로, 없으면(GET·DELETE·알림) 502로 답한다
  function failureReply(
    request: McpHttpRequest,
    kind: FailureKind,
    endpointId: string,
  ): McpHttpResponse {
    const message = failureMessage(kind, endpointId);
    const json = request.body?.json;
    const requests = (Array.isArray(json) ? json : [json]).filter(isRequest);
    if (requests.length === 0) {
      return jsonReply(502, errorResponse(null, RPC_ERROR.upstream, message));
    }
    const responses = requests.map((item) => errorResponse(item.id, RPC_ERROR.upstream, message));
    return jsonReply(200, Array.isArray(json) ? responses : (responses[0] as JsonRpcResponse));
  }

  function background(task: Promise<unknown>, what: string): void {
    task.catch((error: unknown) => {
      deps.log.warn({ task: what, errName: (error as Error)?.name }, 'mcp background write failed');
    });
  }

  async function proxy(
    access: { endpoint: EndpointRow; connector: ConnectorRow },
    request: McpHttpRequest,
  ): Promise<McpHttpResponse> {
    const { endpoint, connector } = access;
    const startedAt = performance.now();

    function recordToolCall(toolName: string, result: ToolCallOutcome | 'denied'): void {
      const durationMs = Math.round(performance.now() - startedAt);
      background(
        insertAuditLog(deps.db, {
          userId: endpoint.ownerId,
          endpointId: endpoint.id,
          connectorId: connector.id,
          toolName,
          result,
          durationMs,
        }),
        'audit_log',
      );
    }

    function touch(): void {
      const ids = { endpointId: endpoint.id, connectorId: connector.id };
      background(touchLastCalled(deps.db, ids, new Date(), LAST_CALLED_INTERVAL_MS), 'last_called');
    }

    function markHealth(status: 'ok' | 'error'): void {
      if (connector.status === status) return;
      background(setConnectorHealth(deps.db, connector.id, status), 'connector_health');
    }

    let plan: ReturnType<typeof planInbound> = { kind: 'forward', toolCalls: new Map() };
    if (request.method === 'POST') {
      if (request.body?.json === undefined) {
        return jsonReply(400, errorResponse(null, RPC_ERROR.parseError, 'JSON 본문이 아닙니다.'));
      }
      plan = planInbound(request.body.json, endpoint.allowedTools);
    }
    if (plan.kind === 'deny') {
      for (const toolName of plan.deniedTools) recordToolCall(toolName, 'denied');
      touch();
      return plan.response
        ? jsonReply(200, plan.response)
        : { status: 202, headers: {}, body: null };
    }
    if (plan.toolCalls.size > 0) touch();
    const tap = createResponseTap(plan, endpoint.allowedTools, recordToolCall);

    let response: Response;
    try {
      const credentials = await loadCredentials(deps, connector.id, endpoint.ownerId);
      response = await runtimeFor(deps.runtimes, connector.manifest).forward(
        {
          manifest: connector.manifest,
          credentials,
          credentialRef: { connectorId: connector.id, userId: endpoint.ownerId },
        },
        {
          method: request.method,
          headers: pickHeaders((name) => request.headers[name], REQUEST_HEADERS),
          body: request.method === 'POST' ? request.body?.raw : undefined,
          signal: request.signal,
          adminUrl: adminUrl(endpoint.id),
        },
      );
    } catch (error) {
      tap.settle();
      // 클라이언트가 먼저 끊었으면 돌려줄 곳이 없다
      if (request.signal.aborted) return { status: 499, headers: {}, body: null };
      const kind = error instanceof UpstreamError ? error.kind : 'unreachable';
      deps.log.warn({ upstreamError: kind, endpointId: endpoint.id }, 'mcp upstream failed');
      markHealth('error');
      return failureReply(request, kind, endpoint.id);
    }

    const status = response.status;
    const headers = pickHeaders((name) => response.headers.get(name), RESPONSE_HEADERS);
    const contentType = response.headers.get('content-type') ?? '';

    if (status === 401 || status === 403) {
      await response.body?.cancel();
      tap.settle();
      markHealth('error');
      return failureReply(request, 'auth_failed', endpoint.id);
    }
    // 세션 만료(404)·GET 스트림 미지원(405)·잘못된 요청(400)은 상태를 살려 클라이언트가 대응하게 한다
    if (status >= 400) {
      await response.body?.cancel();
      tap.settle();
      if (status === 400 || status === 404 || status === 405) {
        const message = failureMessage('upstream_error', endpoint.id);
        return { ...jsonReply(status, errorResponse(null, RPC_ERROR.upstream, message)), headers };
      }
      return failureReply(request, 'upstream_error', endpoint.id);
    }

    markHealth('ok');
    // 세션 종료(DELETE)와 알림 수신(202)은 본문 없이 상태만 돌려준다
    if (!response.body || request.method === 'DELETE' || status === 202 || status === 204) {
      await response.body?.cancel();
      tap.settle();
      return { status, headers, body: null };
    }
    if (contentType.startsWith('text/event-stream')) {
      const body = onSettled(response.body.pipeThrough(rewriteSse(tap.rewrite)), tap.settle);
      return {
        status,
        headers: { ...headers, 'cache-control': 'no-cache', 'x-accel-buffering': 'no' },
        body,
      };
    }
    if (contentType.startsWith('application/json')) {
      const text = await response.text();
      let body = text;
      try {
        body = JSON.stringify(tap.rewrite(JSON.parse(text)));
      } catch {
        // JSON이 아니면 고치지 않고 넘긴다
      }
      tap.settle();
      return { status, headers, body };
    }
    // 그 밖의 본문은 MCP 응답이 아니다
    await response.body.cancel();
    tap.settle();
    return failureReply(request, 'upstream_error', endpoint.id);
  }

  // 사용 중지된 커넥터로 온 tools/call도 거부로 남긴다 (SCR-ADM-06 요약의 거부)
  function recordDenied(
    access: { endpoint: EndpointRow; connector: ConnectorRow },
    body: McpRequestBody | undefined,
  ): void {
    const { endpoint, connector } = access;
    for (const toolName of toolCallNames(body?.json)) {
      background(
        insertAuditLog(deps.db, {
          userId: endpoint.ownerId,
          endpointId: endpoint.id,
          connectorId: connector.id,
          toolName,
          result: 'denied',
          durationMs: 0,
        }),
        'audit_log',
      );
    }
  }

  return { proxy, recordDenied };
}

export type McpProxy = ReturnType<typeof createMcpProxy>;
