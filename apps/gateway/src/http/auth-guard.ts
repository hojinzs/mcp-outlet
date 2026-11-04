import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/client.ts';
import { resolveSession, type SessionUser } from '../services/sessions.ts';
import { SESSION_COOKIE } from './cookies.ts';
import { HttpError } from './errors.ts';

declare module 'fastify' {
  interface FastifyRequest {
    // requireSession을 거친 요청에만 채워진다
    user: SessionUser | null;
  }
}

export function createAuthGuards(deps: { db: Db; now: () => Date }) {
  // 세션 행과 사용자 role을 매 요청 DB에서 읽는다. 행을 지우면 다음 요청부터 401 (F-AUTH-02)
  async function requireSession(request: FastifyRequest): Promise<void> {
    const token = request.cookies[SESSION_COOKIE];
    const user = token ? await resolveSession(deps.db, token, deps.now()) : null;
    if (!user) throw new HttpError('unauthorized');
    request.user = user;
  }

  // requireSession 뒤에 둔다. 관리자 API는 매 요청 role을 확인한다
  async function requireAdmin(request: FastifyRequest): Promise<void> {
    if (request.user?.role !== 'admin') throw new HttpError('forbidden');
  }

  return { requireSession, requireAdmin };
}

export type AuthGuards = ReturnType<typeof createAuthGuards>;

// requireSession이 걸린 라우트에서 현재 사용자를 꺼낸다
export function sessionUser(request: FastifyRequest): SessionUser {
  if (!request.user) throw new HttpError('unauthorized');
  return request.user;
}
