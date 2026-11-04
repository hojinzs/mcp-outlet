import type { CookieSerializeOptions } from '@fastify/cookie';
import { LOGIN_STATE_TTL_MS } from '../auth/login-state.ts';
import type { Config } from '../config.ts';

export const SESSION_COOKIE = 'outlet_session';
// 로그인 시작부터 콜백까지만 쓴다. 콜백 경로에만 보낸다
export const LOGIN_STATE_COOKIE = 'outlet_login';
// IdP 로그아웃(end_session)의 id_token_hint. 로그아웃 경로에만 보낸다.
// 세션 테이블을 바꾸지 않으려고 DB 대신 쿠키에 둔다
export const ID_TOKEN_COOKIE = 'outlet_id_token';

// 리버스 프록시 뒤에서도 외부 주소 기준으로 Secure를 정한다
function isSecure(config: Config): boolean {
  return new URL(config.PUBLIC_BASE_URL).protocol === 'https:';
}

// SameSite=Lax: IdP에서 돌아오는 최상위 GET에는 실리고, 다른 사이트의 POST에는 실리지 않는다
export function sessionCookieOptions(config: Config, expires?: Date): CookieSerializeOptions {
  return { path: '/', httpOnly: true, sameSite: 'lax', secure: isSecure(config), expires };
}

export function loginStateCookieOptions(config: Config): CookieSerializeOptions {
  return {
    path: '/auth',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure(config),
    maxAge: LOGIN_STATE_TTL_MS / 1000,
  };
}

export function idTokenCookieOptions(config: Config): CookieSerializeOptions {
  return {
    path: '/auth/logout',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure(config),
    maxAge: config.SESSION_TTL_HOURS * 60 * 60,
  };
}
