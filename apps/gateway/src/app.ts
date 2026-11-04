import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { createOidcClient } from './auth/oidc.ts';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import { createAuthGuards } from './http/auth-guard.ts';
import { registerErrorHandlers, sendError } from './http/errors.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerHealth } from './routes/health.ts';
import { registerMe } from './routes/me.ts';

// 테스트에서 IdP 통신과 시계를 바꿔 끼운다
export type AppDeps = {
  fetch: typeof fetch;
  now: () => Date;
};

const defaultDeps: AppDeps = { fetch: globalThis.fetch, now: () => new Date() };

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
  });

  registerErrorHandlers(app);
  await app.register(fastifyCookie);
  app.decorateRequest('user', null);

  const oidc = createOidcClient(
    {
      discoveryUrl: config.OIDC_DISCOVERY_URL,
      clientId: config.OIDC_CLIENT_ID,
      clientSecret: config.OIDC_CLIENT_SECRET,
    },
    deps,
  );
  const guards = createAuthGuards({ db, now: deps.now });

  registerHealth(app, db);
  registerAuthRoutes(app, { config, db, oidc, now: deps.now });
  await app.register(
    async (api) => {
      api.addHook('preHandler', guards.requireSession);
      registerMe(api);
    },
    { prefix: '/api' },
  );

  const serveAdmin = await registerAdminUi(app, config);
  app.setNotFoundHandler((request, reply) => {
    // SPA 라우팅: /admin 아래 없는 경로는 index.html로
    if (serveAdmin && request.method === 'GET' && request.url.startsWith('/admin')) {
      return reply.sendFile('index.html');
    }
    return sendError(reply, 'not_found');
  });

  return app;
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
