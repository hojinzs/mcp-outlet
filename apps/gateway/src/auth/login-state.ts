import { z } from 'zod';
import { pkceChallenge, randomToken, signValue, unsignValue } from '../crypto/tokens.ts';

// 로그인 시작부터 콜백까지만 쓰는 값. SESSION_SECRET으로 서명한 짧은 수명 쿠키에 담는다 (F-AUTH-02)
const loginStateSchema = z.object({
  state: z.string().min(1),
  nonce: z.string().min(1),
  codeVerifier: z.string().min(43),
  returnTo: z.string(),
  expiresAt: z.number().int(),
});

export type LoginState = z.infer<typeof loginStateSchema>;

export const LOGIN_STATE_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_RETURN_TO = '/admin/';

// 오픈 리다이렉트 방지: /admin/ 아래 경로만 받는다 (SCR-COM-02)
export function safeReturnTo(value: string | undefined): string {
  if (!value?.startsWith('/admin/') || value.includes('\\')) return DEFAULT_RETURN_TO;
  return value;
}

export function createLoginState(returnTo: string | undefined, now: Date): LoginState {
  return {
    state: randomToken(),
    nonce: randomToken(),
    codeVerifier: randomToken(),
    returnTo: safeReturnTo(returnTo),
    expiresAt: now.getTime() + LOGIN_STATE_TTL_MS,
  };
}

export function codeChallengeOf(loginState: LoginState): string {
  return pkceChallenge(loginState.codeVerifier);
}

export function serializeLoginState(loginState: LoginState, secret: string): string {
  return signValue(Buffer.from(JSON.stringify(loginState)).toString('base64url'), secret);
}

// 서명이 틀리거나 만료됐거나 콜백의 state와 다르면 null
export function readLoginState(
  cookie: string | undefined,
  secret: string,
  expectedState: string,
  now: Date,
): LoginState | null {
  if (!cookie) return null;
  const encoded = unsignValue(cookie, secret);
  if (!encoded) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString());
  } catch {
    return null;
  }
  const result = loginStateSchema.safeParse(parsed);
  if (!result.success) return null;
  const loginState = result.data;
  if (loginState.expiresAt <= now.getTime() || loginState.state !== expectedState) return null;
  return loginState;
}
