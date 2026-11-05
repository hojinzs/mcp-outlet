import type { SecretBox } from '../crypto/secrets.ts';
import type { Db } from '../db/client.ts';
import { insertAuditLog } from '../db/queries/audit-logs.ts';
import { type ConnectorRow, setConnectorHealth } from '../db/queries/connectors.ts';
import { type EndpointRow, touchLastCalled } from '../db/queries/endpoints.ts';
import { type FailureKind, failureMessage, toolFailureResult } from '../mcp/failures.ts';
import { errorResponse, isRequest, type JsonRpcResponse, RPC_ERROR } from '../mcp/jsonrpc.ts';
import { type BoundedText, MAX_UPSTREAM_MESSAGE_BYTES, readBoundedText } from '../mcp/limits.ts';
import { rewriteSse } from '../mcp/sse.ts';
import {
  auditToolName,
  createResponseTap,
  deniedAuditNames,
  planInbound,
  type ToolCallOutcome,
  toolCallNames,
} from '../mcp/tool-policy.ts';
import { type Runtimes, runtimeFor } from '../runtimes/index.ts';
import { UpstreamError } from '../upstream/safe-fetch.ts';
import { loadCredentials } from './credentials.ts';

// /c/{id}/mcp 요청 하나를 업스트림에 중계한다 (F-EP-02, F-RUN-01·03, F-UI-03).
// 허용목록·감사 로그·오류 정리는 여기서, 업스트림 전송은 런타임이 맡는다

export type McpProxyDeps = {
  db: Db;
  secrets: SecretBox;
  runtimes: Runtimes;
  publicBaseUrl: string;
  // JSON 응답 본문을 다 받을 때까지의 상한. 응답 헤더 상한(safe-fetch)과 같은 UPSTREAM_TIMEOUT_MS
  upstreamTimeoutMs: number;
  // 로그에는 분류값만 남긴다
  log: { warn: (fields: Record<string, unknown>, message: string) => void };
};

// JSON으로 읽지 못한 본문은 json이 undefined
export type McpRequestBody = { json: unknown };

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

// JSON 본문을 다 받지 못한 이유. 끊김·시간 초과는 연결 실패와 같게 다룬다
const BODY_FAILURE = {
  too_large: 'upstream_error',
  timeout: 'timeout',
  aborted: 'unreachable',
} as const satisfies Record<Exclude<BoundedText, { text: string }>['rejected'], FailureKind>;

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

  // 요청이 있으면 요청마다 답하고, 없으면(GET·DELETE·알림) 502로 답한다.
  // tools/call은 isError 툴 결과로, 그 밖의 요청은 JSON-RPC 오류로 준다 (F-RUN-03 툴 호출 실패 형식)
  function failureReply(
    request: McpHttpRequest,
    kind: FailureKind,
    endpointId: string,
  ): McpHttpResponse {
    const url = adminUrl(endpointId);
    const message = failureMessage(kind, url);
    const json = request.body?.json;
    const requests = (Array.isArray(json) ? json : [json]).filter(isRequest);
    if (requests.length === 0) {
      return jsonReply(502, errorResponse(null, RPC_ERROR.upstream, message));
    }
    const responses = requests.map(
      (item): JsonRpcResponse =>
        item.method === 'tools/call'
          ? { jsonrpc: '2.0', id: item.id, result: toolFailureResult(kind, url) }
          : errorResponse(item.id, RPC_ERROR.upstream, message),
    );
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
          toolName: auditToolName(toolName),
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

    let health = connector.status;
    let healthWrite: Promise<unknown> = Promise.resolve();
    function markHealth(status: 'ok' | 'error'): void {
      if (health === status) return;
      health = status;
      // JSON 본문을 읽다 끊기면 한 요청에서 ok 다음 error를 쓴다. 순서가 뒤바뀌지 않게 이어 쓴다
      healthWrite = healthWrite
        .catch(() => {})
        .then(() => setConnectorHealth(deps.db, connector.id, status));
      background(healthWrite, 'connector_health');
    }

    // builtin은 툴을 부를 때만 외부 API에 닿고, 실패도 HTTP 200의 툴 결과(isError)로 온다.
    // 성공한 툴 결과가 있어야 정상으로 되돌린다
    const builtin = connector.manifest.runtime === 'builtin';
    function onToolCall(toolName: string, outcome: ToolCallOutcome): void {
      recordToolCall(toolName, outcome);
      if (builtin && outcome === 'ok') markHealth('ok');
    }

    let plan: ReturnType<typeof planInbound> = { kind: 'forward', toolCalls: new Map() };
    // 허용목록을 판정한 파싱 결과를 다시 직렬화해 보낸다. 원문을 보내면 중복 키를 업스트림이
    // 다르게 읽어(앞의 값을 쓰는 파서) 판정한 툴과 다른 툴이 불릴 수 있다 (F-EP-02)
    let forwardBody: string | undefined;
    if (request.method === 'POST') {
      if (request.body?.json === undefined) {
        return jsonReply(400, errorResponse(null, RPC_ERROR.parseError, 'JSON 본문이 아닙니다.'));
      }
      plan = planInbound(request.body.json, endpoint.allowedTools);
      forwardBody = JSON.stringify(request.body.json);
    }
    if (plan.kind === 'deny') {
      for (const toolName of deniedAuditNames(plan.deniedTools)) recordToolCall(toolName, 'denied');
      // 리소스·프롬프트만 거부했으면 툴 호출이 아니라 마지막 호출 시각을 바꾸지 않는다
      if (plan.deniedTools.length > 0) touch();
      return plan.response
        ? jsonReply(200, plan.response)
        : { status: 202, headers: {}, body: null };
    }
    if (plan.toolCalls.size > 0) touch();
    const tap = createResponseTap(plan, endpoint.allowedTools, onToolCall);

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
          body: forwardBody,
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
        const message = failureMessage('upstream_error', adminUrl(endpoint.id));
        return { ...jsonReply(status, errorResponse(null, RPC_ERROR.upstream, message)), headers };
      }
      return failureReply(request, 'upstream_error', endpoint.id);
    }

    if (!builtin) markHealth('ok');
    // 세션 종료(DELETE)와 알림 수신(202)은 본문 없이 상태만 돌려준다
    if (!response.body || request.method === 'DELETE' || status === 202 || status === 204) {
      await response.body?.cancel();
      tap.settle();
      return { status, headers, body: null };
    }
    if (contentType.startsWith('text/event-stream')) {
      const body = onSettled(
        response.body.pipeThrough(rewriteSse(tap.rewrite, MAX_UPSTREAM_MESSAGE_BYTES)),
        tap.settle,
      );
      return {
        status,
        headers: { ...headers, 'cache-control': 'no-cache', 'x-accel-buffering': 'no' },
        body,
      };
    }
    if (contentType.startsWith('application/json')) {
      const read = await readBoundedText(response.body, {
        maxBytes: MAX_UPSTREAM_MESSAGE_BYTES,
        timeoutMs: deps.upstreamTimeoutMs,
      });
      if ('rejected' in read) {
        // 응답이 오지 않은 tools/call은 SSE가 중간에 끊긴 경우처럼 오류로 남긴다
        tap.settle();
        if (request.signal.aborted) return { status: 499, headers: {}, body: null };
        deps.log.warn({ upstream: `response_${read.rejected}` }, 'upstream response rejected');
        const kind = BODY_FAILURE[read.rejected];
        if (kind !== 'upstream_error') markHealth('error');
        return failureReply(request, kind, endpoint.id);
      }
      const text = read.text;
      let body: string | null = text;
      try {
        const rewritten = tap.rewrite(JSON.parse(text));
        // 걸러서 보낼 메시지가 남지 않으면(리소스·프롬프트 알림뿐이면) 본문 없이 답한다
        body = rewritten === undefined ? null : JSON.stringify(rewritten);
      } catch {
        // JSON이 아니면 고치지 않고 넘긴다
      }
      tap.settle();
      if (body === null) return { status: 202, headers, body: null };
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
    for (const toolName of deniedAuditNames(toolCallNames(body?.json))) {
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
