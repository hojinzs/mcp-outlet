import { RUNNER_TOKEN_HEADER } from '@mcp-outlet/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const token = 't'.repeat(32);
const app = buildApp(loadConfig({ RUNNER_TOKEN: token, LOG_LEVEL: 'fatal' }));

afterAll(() => app.close());

describe('runner 내부 인증', () => {
  it('/health는 토큰 없이 응답한다', async () => {
    const response = await app.inject({ url: '/health' });
    expect(response.statusCode).toBe(200);
  });

  it('토큰이 없거나 틀리면 401', async () => {
    expect((await app.inject({ url: '/processes' })).statusCode).toBe(401);
    const wrong = await app.inject({
      url: '/processes',
      headers: { [RUNNER_TOKEN_HEADER]: 'x'.repeat(32) },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('토큰이 맞으면 라우팅까지 통과한다', async () => {
    const response = await app.inject({
      url: '/processes',
      headers: { [RUNNER_TOKEN_HEADER]: token },
    });
    expect(response.statusCode).toBe(404);
  });
});
