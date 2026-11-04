import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DEFAULT_RETURN_TO } from '../auth/login-state.ts';
import { openUpstreamState } from '../auth/upstream-state.ts';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import {
  SESSION_COOKIE,
  UPSTREAM_STATE_COOKIE,
  upstreamStateCookieOptions,
} from '../http/cookies.ts';
import { resolveSession } from '../services/sessions.ts';
import { completeUpstreamOAuth, type UpstreamOAuthDeps } from '../services/upstream-oauth.ts';

// 업스트림 OAuth 콜백 {PUBLIC_BASE_URL}/auth/upstream/callback (F-CON-03).
// 결과를 쿼리에 붙여 원래 화면(엔드포인트 추가·상세)으로 돌려보낸다. 별도 화면은 없다

export type UpstreamAuthRouteDeps = { config: Config; db: Db; services: UpstreamOAuthDeps };

// SCR-EP-02 오류: 동의 취소 / 토큰 교환 실패
type ConnectError = 'cancelled' | 'failed';

const callbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
});

function withParam(path: string, name: string, value: string): string {
  const url = new URL(path, 'http://outlet.invalid');
  url.searchParams.set(name, value);
  return `${url.pathname}${url.search}`;
}

export function registerUpstreamAuthRoutes(app: FastifyInstance, deps: UpstreamAuthRouteDeps) {
  const { config, services } = deps;

  app.get('/auth/upstream/callback', async (request, reply) => {
    const query = callbackQuery.safeParse(request.query);
    const cookie = request.cookies[UPSTREAM_STATE_COOKIE];
    reply.clearCookie(UPSTREAM_STATE_COOKIE, upstreamStateCookieOptions(config));
    const now = services.now();

    const stateParam = query.success ? query.data.state : undefined;
    const state = stateParam ? openUpstreamState(cookie, services.secrets, stateParam, now) : null;
    const returnTo = state?.returnTo ?? DEFAULT_RETURN_TO;
    const fail = (code: ConnectError, why: string): FastifyReply => {
      // 업스트림이 준 error_description·코드는 남기지 않는다
      request.log.warn({ upstreamOAuth: why }, 'upstream oauth callback failed');
      return reply.redirect(withParam(returnTo, 'connect_error', code));
    };

    if (!query.success || !state) return fail('failed', 'state_mismatch');
    if (query.data.error) {
      return fail(query.data.error === 'access_denied' ? 'cancelled' : 'failed', 'upstream_error');
    }
    if (!query.data.code) return fail('failed', 'no_code');

    const token = request.cookies[SESSION_COOKIE];
    const user = token ? await resolveSession(deps.db, token, now) : null;
    if (!user) return fail('failed', 'no_session');

    const result = await completeUpstreamOAuth(services, user.id, state, query.data.code);
    if (result !== 'connected') return fail('failed', result);
    return reply.redirect(withParam(returnTo, 'connected', '1'));
  });
}
