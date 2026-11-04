import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.ts';
import { sessionUser } from '../http/auth-guard.ts';
import { revealClientSecret } from '../services/client-secret.ts';

// 연결 안내의 Client Secret 보기·복사 (SCR-EP-04). requireSession이 걸린 /api 범위에 등록한다
export function registerConnectSecret(
  api: FastifyInstance,
  deps: { db: Db; clientSecret: string | undefined },
): void {
  api.get('/connect-secret', async (request, reply) => {
    const result = await revealClientSecret(deps, sessionUser(request).id);
    // 브라우저·프록시 캐시에 남기지 않는다
    return reply.header('cache-control', 'no-store').send(result);
  });
}
