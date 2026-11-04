import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.ts';

export function registerHealth(app: FastifyInstance, db: Db): void {
  app.get('/health', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'error', db: 'unreachable' });
    }
  });
}
