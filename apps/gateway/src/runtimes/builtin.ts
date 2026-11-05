import {
  BuiltinApiError,
  type BuiltinCallContext,
  type BuiltinErrorKind,
} from '@mcp-outlet/builtin-connectors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { type Builtins, resolveBuiltin } from '../services/builtin-auth.ts';
import type { UpstreamTokens } from '../services/upstream-tokens.ts';
import { TokenError, type TokenErrorKind } from '../upstream/oauth2.ts';
import type {
  ConnectionTest,
  ConnectionTestResult,
  ConnectorRuntime,
  ForwardRequest,
  RuntimeConnector,
} from './types.ts';

// builtin: gateway 안의 TS 모듈을 MCP 서버로 감싼다 (F-RUN-02).
// 요청마다 상태 없는 Streamable HTTP 서버를 만들어 응답을 돌려준다. 허용목록·감사 로그는 호출하는 쪽이 맡는다

export type BuiltinRuntimeDeps = {
  builtins: Builtins;
  tokens: UpstreamTokens;
  // 외부 API 호출. 주소는 내장 커넥터 코드에만 있으므로 사용자 URL용 SSRF 검사를 거치지 않는다
  fetch: typeof fetch;
  timeoutMs: number;
};

type Failure = Exclude<ConnectionTestResult, 'ok'>;

const tokenFailure: Record<TokenErrorKind, Failure> = {
  invalid_grant: 'auth_failed',
  token_error: 'auth_failed',
  timeout: 'timeout',
  unreachable: 'unreachable',
};

const apiFailure: Record<BuiltinErrorKind, Failure> = {
  auth_failed: 'auth_failed',
  permission_denied: 'permission_denied',
  not_found: 'permission_denied',
  invalid_argument: 'upstream_error',
  rate_limited: 'upstream_error',
  timeout: 'timeout',
  unreachable: 'unreachable',
  upstream_error: 'upstream_error',
};

// 토큰을 받지 못하면 툴 결과 오류로 알린다. 다시 연결해야 하면 관리 화면 주소를 붙인다 (F-RUN-03)
function tokenErrorResult(error: unknown, adminUrl: string): CallToolResult {
  const kind = error instanceof TokenError ? error.kind : 'token_error';
  const text =
    kind === 'invalid_grant'
      ? `커넥터의 계정 연결이 만료되었거나 취소되었습니다. 관리 화면에서 다시 연결하세요: ${adminUrl}`
      : kind === 'token_error'
        ? `업스트림이 토큰 발급을 거부했습니다. 관리 화면에서 커넥터 설정을 확인하세요: ${adminUrl}`
        : '업스트림 인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.';
  return { isError: true, content: [{ type: 'text', text }] };
}

function methodNotAllowed(): Response {
  return Response.json(
    { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed.' } },
    { status: 405, headers: { allow: 'POST' } },
  );
}

export function createBuiltinRuntime(deps: BuiltinRuntimeDeps): ConnectorRuntime {
  function callContext(accessToken: string, signal?: AbortSignal): BuiltinCallContext {
    const deadline = AbortSignal.timeout(deps.timeoutMs);
    return {
      accessToken,
      fetch: deps.fetch,
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    };
  }

  // 토큰 발급(자격증명 확인)과 가벼운 조회가 되면 정적 툴 목록을 돌려준다 (F-CON-05)
  async function testConnection(connector: RuntimeConnector): Promise<ConnectionTest> {
    const { builtin } = resolveBuiltin(deps.builtins, connector.manifest);
    try {
      const accessToken = await deps.tokens.accessToken(connector);
      await builtin.checkAccess(callContext(accessToken));
    } catch (error) {
      if (error instanceof TokenError) {
        return {
          result: tokenFailure[error.kind],
          ...(error.kind === 'invalid_grant' ? { reauthRequired: true } : {}),
        };
      }
      if (error instanceof BuiltinApiError) return { result: apiFailure[error.kind] };
      throw error;
    }
    const tools = builtin.listTools().map(({ name, title, description, annotations }) => ({
      name,
      title,
      description,
      annotations,
    }));
    return { result: 'ok', tools };
  }

  // 상태 없는 서버라 GET 스트림과 세션 종료(DELETE)는 지원하지 않는다
  async function forward(connector: RuntimeConnector, request: ForwardRequest): Promise<Response> {
    if (request.method !== 'POST') return methodNotAllowed();
    const { builtin } = resolveBuiltin(deps.builtins, connector.manifest);

    const server = new Server(
      { name: builtin.key, version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    // 업스트림이 자격증명을 거부했으면 응답 대신 401을 돌려 호출하는 쪽이 커넥터를 오류로 바꾸게 한다
    let credentialRejected = false;
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: builtin.listTools() }));
    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      let accessToken: string;
      try {
        accessToken = await deps.tokens.accessToken(connector);
      } catch (error) {
        return tokenErrorResult(error, request.adminUrl);
      }
      const ctx = callContext(accessToken, request.signal);
      try {
        return await builtin.callTool(params.name, params.arguments ?? {}, ctx);
      } catch (error) {
        if (error instanceof BuiltinApiError) credentialRejected = true;
        throw error;
      }
    });

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      const response = await transport.handleRequest(
        new Request('http://builtin.invalid/mcp', {
          method: 'POST',
          headers: request.headers,
          body: request.body,
          signal: request.signal,
        }),
      );
      if (!credentialRejected) return response;
      await response.body?.cancel();
      return new Response(null, { status: 401 });
    } finally {
      await server.close();
    }
  }

  return { testConnection, forward };
}
