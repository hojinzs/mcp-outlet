import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import { registerErrorHandlers, sendError } from './http/errors.ts';
import { registerHealth } from './routes/health.ts';

export async function buildApp(config: Config, db: Db) {
  const app = Fastify({ logger: { level: config.LOG_LEVEL }, trustProxy: config.TRUST_PROXY });

  registerErrorHandlers(app);
  registerHealth(app, db);

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
