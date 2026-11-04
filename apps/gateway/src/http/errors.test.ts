import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ServiceError } from '../services/errors.ts';
import { HttpError, registerErrorHandlers, sendError } from './errors.ts';

function buildTestApp() {
  const app = Fastify();
  registerErrorHandlers(app);
  app.get('/forbidden', async () => {
    throw new HttpError('forbidden');
  });
  app.get('/zod', async (request) => z.object({ n: z.coerce.number() }).parse(request.query));
  app.get('/boom', async () => {
    throw new Error('secret-token-123 in message');
  });
  app.post('/json', async () => ({ ok: true }));
  app.get('/service', async () => {
    throw new ServiceError('connection_test_failed', { result: 'auth_failed' });
  });
  app.setNotFoundHandler((_request, reply) => sendError(reply, 'not_found'));
  return app;
}

describe('오류 응답', () => {
  it('HttpError를 공통 형식으로 돌려준다', async () => {
    const res = await buildTestApp().inject('/forbidden');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: { code: 'forbidden', message: expect.any(String) },
      requestId: expect.any(String),
    });
  });

  it('ServiceError는 분류에 맞는 상태 코드와 details를 준다', async () => {
    const res = await buildTestApp().inject('/service');
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: {
        code: 'connection_test_failed',
        message: expect.any(String),
        details: { result: 'auth_failed' },
      },
      requestId: expect.any(String),
    });
  });

  it('zod 검증 오류는 400 invalid_request', async () => {
    const res = await buildTestApp().inject('/zod?n=abc');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_request');
  });

  it('Fastify 4xx(본문 파싱 실패)는 400 invalid_request', async () => {
    const res = await buildTestApp().inject({
      method: 'POST',
      url: '/json',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_request');
  });

  it('예상하지 못한 예외는 원문 없이 500', async () => {
    const res = await buildTestApp().inject('/boom');
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('internal_error');
    expect(res.body).not.toContain('secret-token-123');
  });

  it('없는 경로는 404 not_found', async () => {
    const res = await buildTestApp().inject('/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
});
