import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import { registerHealth } from './routes/health.ts';

export async function buildApp(config: Config, db: Db) {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

  registerHealth(app, db);

  if (config.WEB_DIST_DIR) {
    const root = resolve(config.WEB_DIST_DIR);
    if (existsSync(root)) {
      await app.register(fastifyStatic, { root, prefix: '/admin/' });
      // SPA 라우팅: /admin 아래 없는 경로는 index.html로
      app.setNotFoundHandler((request, reply) => {
        if (request.method === 'GET' && request.url.startsWith('/admin')) {
          return reply.sendFile('index.html');
        }
        return reply.code(404).send({ error: 'not_found' });
      });
    } else {
      app.log.warn({ root }, 'WEB_DIST_DIR가 없어 관리 UI를 서빙하지 않습니다');
    }
  }

  return app;
}
