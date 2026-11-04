import { timingSafeEqual } from 'node:crypto';
import { RUNNER_TOKEN_HEADER } from '@mcp-outlet/shared';
import Fastify from 'fastify';
import type { RunnerConfig } from './config.ts';

export function buildApp(config: RunnerConfig) {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  const expected = Buffer.from(config.RUNNER_TOKEN);

  // /health 외 모든 요청은 gateway와 공유한 토큰이 있어야 한다
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health') return;
    const given = Buffer.from(String(request.headers[RUNNER_TOKEN_HEADER] ?? ''));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
