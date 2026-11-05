import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { Db } from '../db/client.ts';
import { registerHealth } from './health.ts';

// DB 대신 execute만 흉내 낸다
async function healthWith(execute: () => Promise<unknown>) {
  const app = Fastify();
  registerHealth(app, { execute } as unknown as Db);
  return app.inject('/health');
}

describe('/health', () => {
  it('DB가 응답하면 200', async () => {
    const res = await healthWith(async () => []);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('DB가 실패하면 503이고 원문 예외는 담지 않는다', async () => {
    const res = await healthWith(async () => {
      throw new Error('password authentication failed for user "outlet"');
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', db: 'unreachable' });
    expect(res.body).not.toContain('password');
  });
});
