import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { builtinConnectors } from '@mcp-outlet/builtin-connectors';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { createOidcClient } from './auth/oidc.ts';
import type { Config } from './config.ts';
import { createSecretBox } from './crypto/secrets.ts';
import type { Db } from './db/client.ts';
import { createAuthGuards } from './http/auth-guard.ts';
import { registerErrorHandlers, sendError } from './http/errors.ts';
import { registerAdminRoutes } from './routes/admin.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerBuiltinRoutes } from './routes/builtins.ts';
import { registerConnectSecret } from './routes/connect-secret.ts';
import { registerConnectorRoutes } from './routes/connectors.ts';
import { registerEndpointRoutes } from './routes/endpoints.ts';
import { registerHealth } from './routes/health.ts';
import { registerMcpRoutes } from './routes/mcp.ts';
import { registerMe } from './routes/me.ts';
import { registerUpstreamAuthRoutes } from './routes/upstream-auth.ts';
import { createRuntimes } from './runtimes/index.ts';
import type { Builtins } from './services/builtin-auth.ts';
import type { EndpointServiceDeps } from './services/endpoints.ts';
import { createMcpProxy } from './services/mcp-proxy.ts';
import type { UpstreamOAuthDeps } from './services/upstream-oauth.ts';
import { createUpstreamTokens } from './services/upstream-tokens.ts';
import { createOAuth2Client } from './upstream/oauth2.ts';
import { createUpstreamFetch } from './upstream/safe-fetch.ts';

// 테스트에서 IdP 통신, 내장 커넥터의 외부 API·토큰 호출, 시계를 바꿔 끼운다
export type AppDeps = {
  fetch: typeof fetch;
  apiFetch: typeof fetch;
  builtins: Builtins;
  now: () => Date;
};

const defaultDeps: AppDeps = {
  fetch: globalThis.fetch,
  apiFetch: globalThis.fetch,
  builtins: builtinConnectors,
  now: () => new Date(),
};

// 쿼리 문자열에는 인가 코드·state가 실리므로 경로만 남긴다
const logSerializers = {
  req: (request: FastifyRequest) => ({
    method: request.method,
    url: request.url.split('?')[0],
    remoteAddress: request.ip,
  }),
};

export async function buildApp(config: Config, db: Db, overrides: Partial<AppDeps> = {}) {
  const deps = { ...defaultDeps, ...overrides };
  const app = Fastify({
    logger: { level: config.LOG_LEVEL, serializers: logSerializers },
    trustProxy: config.TRUST_PROXY,
    // MCP SSE 스트림은 오래 열려 있으므로 종료할 때 기다리지 않고 끊는다. 클라이언트가 다시 붙는다
    forceCloseConnections: true,
  });

  registerErrorHandlers(app);
  await app.register(fastifyCookie);
  app.decorateRequest('user', null);

  const oidc = createOidcClient(
    {
      discoveryUrl: config.OIDC_DISCOVERY_URL,
      clientId: config.OIDC_CLIENT_ID,
      clientSecret: config.OIDC_CLIENT_SECRET,
      scopes: config.OIDC_SCOPES,
    },
    deps,
  );
  const guards = createAuthGuards({ db, now: deps.now });
  const services = createServices(config, db, deps);
  // UPSTREAM_ALLOW_CIDRS를 지정한 설치에서만 http 주소를 입력으로 받는다
  const allowHttp = config.UPSTREAM_ALLOW_CIDRS.length > 0;

  registerHealth(app, db);
  registerAuthRoutes(app, { config, db, oidc, now: deps.now });
  registerUpstreamAuthRoutes(app, { config, db, services });
  await app.register(
    async (api) => {
      api.addHook('preHandler', guards.requireSession);
      registerMe(api);
      registerConnectorRoutes(api, { services, config, allowHttp });
      registerBuiltinRoutes(api, {
        builtins: services.builtins,
        redirectUri: services.redirectUri,
      });
      registerConnectSecret(api, { db, clientSecret: config.OIDC_CLIENT_SECRET });
      registerEndpointRoutes(api, {
        services,
        allowHttp,
        oauthClient: {
          clientId: config.OIDC_CLIENT_ID,
          hasClientSecret: Boolean(config.OIDC_CLIENT_SECRET),
        },
      });
      await registerAdminRoutes(api, {
        db,
        now: deps.now,
        auditRetentionDays: config.AUDIT_RETENTION_DAYS,
        requireAdmin: guards.requireAdmin,
      });
    },
    { prefix: '/api' },
  );

  await registerMcpRoutes(app, {
    db,
    oidc,
    proxy: createMcpProxy({
      ...services,
      upstreamTimeoutMs: config.UPSTREAM_TIMEOUT_MS,
      log: app.log,
    }),
    policy: {
      groupsClaim: config.OIDC_GROUPS_CLAIM,
      loginGroups: config.OIDC_LOGIN_GROUPS,
      adminGroups: config.OIDC_ADMIN_GROUPS,
    },
    publicBaseUrl: config.PUBLIC_BASE_URL,
    audience: config.OIDC_AUDIENCE,
    scopes: config.OIDC_SCOPES,
  });

  const serveAdmin = await registerAdminUi(app, config);
  app.setNotFoundHandler((request, reply) => {
    // SPA 라우팅: /admin 아래 화면 경로는 index.html로. 없는 정적 파일은 404로 둔다
    if (serveAdmin && request.method === 'GET' && isAdminPagePath(request.url)) {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return sendError(reply, 'not_found');
  });

  return app;
}

function createServices(
  config: Config,
  db: Db,
  deps: AppDeps,
): EndpointServiceDeps & UpstreamOAuthDeps {
  const timeoutMs = config.UPSTREAM_TIMEOUT_MS;
  const upstreamFetch = createUpstreamFetch({ allowCidrs: config.UPSTREAM_ALLOW_CIDRS, timeoutMs });
  const secrets = createSecretBox({
    current: config.ENCRYPTION_KEY,
    previous: config.ENCRYPTION_KEY_PREVIOUS,
  });
  const oauth = createOAuth2Client({ fetch: deps.apiFetch, timeoutMs, now: deps.now });
  const tokens = createUpstreamTokens({
    db,
    secrets,
    oauth,
    builtins: deps.builtins,
    now: deps.now,
  });
  return {
    db,
    secrets,
    builtins: deps.builtins,
    runtimes: createRuntimes({
      remote: { fetch: upstreamFetch, timeoutMs },
      builtin: { builtins: deps.builtins, tokens, fetch: deps.apiFetch, timeoutMs },
    }),
    oauth,
    redirectUri: new URL('/auth/upstream/callback', config.PUBLIC_BASE_URL).toString(),
    maxConnectorsPerUser: config.MAX_CONNECTORS_PER_USER,
    maxEndpointsPerUser: config.MAX_ENDPOINTS_PER_USER,
    publicBaseUrl: config.PUBLIC_BASE_URL,
    now: deps.now,
  };
}

function isAdminPagePath(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  if (path !== '/admin' && !path.startsWith('/admin/')) return false;
  return !path.startsWith('/admin/assets/');
}

async function registerAdminUi(app: FastifyInstance, config: Config): Promise<boolean> {
  if (!config.WEB_DIST_DIR) return false;
  const root = resolve(config.WEB_DIST_DIR);
  if (!existsSync(root)) {
    app.log.warn({ root }, 'WEB_DIST_DIR가 없어 관리 UI를 서빙하지 않습니다');
    return false;
  }
  await app.register(fastifyStatic, { root, prefix: '/admin/' });
  return true;
}
