import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  UpstreamError,
  type UpstreamErrorKind,
  type UpstreamFetch,
} from '../upstream/safe-fetch.ts';
import type {
  CachedTool,
  ConnectionTest,
  ConnectionTestResult,
  ConnectorRuntime,
  ForwardRequest,
  RuntimeConnector,
} from './types.ts';

// remote: 사용자가 등록한 원격 MCP(Streamable HTTP) (F-CON-01, F-RUN-01)

export type RemoteRuntimeDeps = {
  fetch: UpstreamFetch;
  timeoutMs: number;
};

// tools/list 페이지 상한. 끝나지 않는 커서를 주는 서버를 막는다
const MAX_TOOL_PAGES = 20;

const testResultOf: Record<UpstreamErrorKind, Exclude<ConnectionTestResult, 'ok'>> = {
  blocked_address: 'private_address',
  // 공인 주소에 http를 쓴 경우도 등록할 수 없는 주소로 본다
  insecure_scheme: 'private_address',
  redirect: 'redirect',
  timeout: 'timeout',
  unreachable: 'unreachable',
};

function remoteUrl(connector: RuntimeConnector): URL {
  if (connector.manifest.runtime !== 'remote') throw new Error('not a remote connector');
  return new URL(connector.manifest.url);
}

// 업스트림 자격증명을 헤더로 만든다. 클라이언트가 보낸 Authorization은 이것으로 바뀐다
export function upstreamAuthHeaders(connector: RuntimeConnector): Record<string, string> {
  const auth = connector.manifest.auth;
  if (auth.type !== 'static_token') return {};
  const token = connector.credentials[auth.credential];
  if (!token) return {};
  return { [auth.header]: `${auth.prefix}${token}` };
}

function toCachedTool(tool: CachedTool): CachedTool {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    annotations: tool.annotations,
  };
}

async function listAllTools(client: Client, timeout: number): Promise<CachedTool[]> {
  const tools: CachedTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
    const result = await client.listTools(cursor ? { cursor } : {}, { timeout });
    tools.push(...result.tools.map(toCachedTool));
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return tools;
}

export function createRemoteRuntime(deps: RemoteRuntimeDeps): ConnectorRuntime {
  // initialize → tools/list. 실패하면 분류만 돌려준다(F-RUN-03). 업스트림 응답 본문은 버린다
  async function testConnection(connector: RuntimeConnector): Promise<ConnectionTest> {
    let failure: Exclude<ConnectionTestResult, 'ok'> | undefined;
    // SDK 오류 메시지에는 업스트림 본문이 섞이므로, 분류는 fetch 단계에서 직접 본다
    const observingFetch: UpstreamFetch = async (input, init) => {
      try {
        const response = await deps.fetch(input, init);
        if (response.status === 401 || response.status === 403) failure ??= 'auth_failed';
        return response;
      } catch (error) {
        if (error instanceof UpstreamError) failure ??= testResultOf[error.kind];
        throw error;
      }
    };

    const transport = new StreamableHTTPClientTransport(remoteUrl(connector), {
      fetch: observingFetch,
      requestInit: { headers: upstreamAuthHeaders(connector) },
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 1000,
        maxReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1,
      },
    });
    const client = new Client({ name: 'mcp-outlet', version: '1.0.0' });
    try {
      await client.connect(transport, { timeout: deps.timeoutMs });
      return { result: 'ok', tools: await listAllTools(client, deps.timeoutMs) };
    } catch (error) {
      if (failure) return { result: failure };
      if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
        return { result: 'timeout' };
      }
      return { result: 'not_mcp' };
    } finally {
      await transport.terminateSession().catch(() => {});
      await client.close().catch(() => {});
    }
  }

  // 클라이언트의 Authorization은 화이트리스트에서 빠지고 업스트림 자격증명으로 바뀐다 (F-RUN-01)
  async function forward(connector: RuntimeConnector, request: ForwardRequest): Promise<Response> {
    return deps.fetch(remoteUrl(connector), {
      method: request.method,
      headers: { ...request.headers, ...upstreamAuthHeaders(connector) },
      body: request.body,
      signal: request.signal,
    });
  }

  return { testConnection, forward };
}
