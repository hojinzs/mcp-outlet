import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AccessPolicy } from '../auth/access.ts';
import { type OidcClient, OidcError } from '../auth/oidc.ts';
import type { Db } from '../db/client.ts';
import { errorResponse, RPC_ERROR } from '../mcp/jsonrpc.ts';
import { endpointUrl, resourceMetadataUrl } from '../mcp/urls.ts';
import { type McpAccess, resolveMcpAccess } from '../services/mcp-access.ts';
import type { McpProxy, McpRequestBody } from '../services/mcp-proxy.ts';

// MCP 엔드포인트 /c/{id}/mcp 와 보호 리소스 메타데이터 (F-AUTH-03~06)

export type McpRouteDeps = {
  db: Db;
  oidc: OidcClient;
  proxy: McpProxy;
  policy: AccessPolicy;
  publicBaseUrl: string;
  audience: string;
};

// 클라이언트가 요청하는 scope. groups는 Authentik 등에서 profile에 실린다
const SCOPES_SUPPORTED = ['openid', 'profile', 'email', 'offline_access'];
// 툴 인자에 파일 내용이 실리기도 해서 기본값(1MB)보다 넉넉히 둔다
const BODY_LIMIT_BYTES = 10 * 1024 * 1024;

const deniedMessages: Record<Exclude<McpAccess['kind'], 'ok'>, [number, string]> = {
  not_member: [403, 'MCP Outlet 사용 그룹에 속해 있지 않습니다. 관리자에게 문의하세요.'],
  not_found: [404, '엔드포인트를 찾을 수 없습니다.'],
  endpoint_disabled: [403, '비활성화된 엔드포인트입니다. 관리 화면에서 다시 켜세요.'],
  connector_disabled: [403, '관리자가 사용 중지한 커넥터입니다. 관리자에게 문의하세요.'],
};

function bearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

function sendRpcError(reply: FastifyReply, status: number, code: number, message: string) {
  return reply
    .code(status)
    .type('application/json')
    .send(errorResponse(null, code, message));
}

export async function registerMcpRoutes(app: FastifyInstance, deps: McpRouteDeps): Promise<void> {
  await app.register(async (scope) => {
    // 원문을 그대로 업스트림에 보내야 해서 직접 읽는다. 깨진 JSON은 JSON-RPC parse error로 답한다
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: BODY_LIMIT_BYTES },
      (_request, raw, done) => {
        let json: unknown;
        try {
          json = JSON.parse(raw as string);
        } catch {
          json = undefined;
        }
        done(null, { raw: raw as string, json } satisfies McpRequestBody);
      },
    );

    // 브라우저에서 동작하는 MCP 클라이언트(Inspector 등)용. 쿠키가 아닌 Bearer만 쓰므로 * 로 연다
    scope.addHook('onRequest', async (_request, reply) => {
      reply.header('access-control-allow-origin', '*');
      reply.header('access-control-expose-headers', 'mcp-session-id, www-authenticate');
    });

    scope.options('/c/:id/mcp', async (_request, reply) =>
      reply
        .code(204)
        .header('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS')
        .header(
          'access-control-allow-headers',
          'authorization, content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id',
        )
        .header('access-control-max-age', '86400')
        .send(),
    );

    // RFC 9728. 엔드포인트가 있는지와 상관없이 같은 모양으로 답한다
    scope.get('/.well-known/oauth-protected-resource/c/:id/mcp', async (request, reply) => {
      const { id } = request.params as { id: string };
      let issuer: string;
      try {
        issuer = await deps.oidc.issuer();
      } catch (error) {
        if (!(error instanceof OidcError)) throw error;
        return reply.code(503).send({ error: 'temporarily_unavailable' });
      }
      return {
        resource: endpointUrl(deps.publicBaseUrl, encodeURIComponent(id)),
        authorization_servers: [issuer],
        scopes_supported: SCOPES_SUPPORTED,
        bearer_methods_supported: ['header'],
        resource_name: 'MCP Outlet',
      };
    });

    scope.route({
      method: ['GET', 'POST', 'DELETE'],
      url: '/c/:id/mcp',
      handler: async (request, reply) => {
        const { id } = request.params as { id: string };
        // 토큰이 없거나 틀리면 엔드포인트가 있든 없든 같은 401
        const unauthorized = (error?: string) => {
          const metadata = resourceMetadataUrl(deps.publicBaseUrl, encodeURIComponent(id));
          const challenge = `Bearer resource_metadata="${metadata}"${error ? `, error="${error}"` : ''}`;
          reply.header('www-authenticate', challenge);
          return sendRpcError(reply, 401, RPC_ERROR.forbidden, '로그인이 필요합니다.');
        };

        const token = bearerToken(request.headers.authorization);
        if (!token) return unauthorized();
        let claims: Awaited<ReturnType<OidcClient['verifyAccessToken']>>;
        try {
          claims = await deps.oidc.verifyAccessToken(token, deps.audience);
        } catch (error) {
          if (!(error instanceof OidcError)) throw error;
          if (error.kind === 'access_token') return unauthorized('invalid_token');
          request.log.warn({ oidcError: error.kind }, 'mcp token verification unavailable');
          return sendRpcError(reply, 503, RPC_ERROR.upstream, '인증 서버에 연결하지 못했습니다.');
        }

        const endpointId = z.uuid().safeParse(id).success ? id : null;
        const access = await resolveMcpAccess(deps.db, claims, endpointId, deps.policy);
        if (access.kind === 'connector_disabled') {
          deps.proxy.recordDenied(access, request.body as McpRequestBody | undefined);
        }
        if (access.kind !== 'ok') {
          const [status, message] = deniedMessages[access.kind];
          return sendRpcError(reply, status, RPC_ERROR.forbidden, message);
        }

        // 클라이언트가 연결을 끊으면 업스트림 요청·스트림도 끊는다 (F-RUN-01 abort 전파)
        const abort = new AbortController();
        reply.raw.on('close', () => {
          if (!reply.raw.writableFinished) abort.abort();
        });
        const result = await deps.proxy.proxy(access, {
          method: request.method as 'GET' | 'POST' | 'DELETE',
          headers: request.headers,
          body: request.body as McpRequestBody | undefined,
          signal: abort.signal,
        });
        reply.code(result.status).headers(result.headers);
        if (result.body instanceof ReadableStream) {
          return reply.send(Readable.fromWeb(result.body as NodeReadableStream<Uint8Array>));
        }
        return reply.send(result.body ?? undefined);
      },
    });
  });
}
