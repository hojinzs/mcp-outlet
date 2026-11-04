import { z } from 'zod';
import type { SecretBox } from '../crypto/secrets.ts';
import { pkceChallenge, randomToken } from '../crypto/tokens.ts';
import { safeReturnTo } from './login-state.ts';

// 업스트림 OAuth 동의 시작부터 콜백까지만 쓰는 값.
// 바꿀 OAuth 앱의 client secret이 실릴 수 있어 서명이 아니라 ENCRYPTION_KEY로 암호화한 쿠키에 담는다
const upstreamStateSchema = z.object({
  state: z.string().min(1),
  codeVerifier: z.string().min(43),
  connectorId: z.uuid(),
  userId: z.uuid(),
  returnTo: z.string(),
  // 다른 OAuth 앱으로 바꿀 때만. 동의가 끝나야 저장한다
  client: z.object({ clientId: z.string(), clientSecret: z.string() }).optional(),
  expiresAt: z.number().int(),
});

export type UpstreamState = z.infer<typeof upstreamStateSchema>;

export const UPSTREAM_STATE_TTL_MS = 10 * 60 * 1000;

export function createUpstreamState(
  input: Pick<UpstreamState, 'connectorId' | 'userId' | 'client'> & {
    returnTo: string | undefined;
  },
  now: Date,
): UpstreamState {
  return {
    state: randomToken(),
    codeVerifier: randomToken(),
    connectorId: input.connectorId,
    userId: input.userId,
    returnTo: safeReturnTo(input.returnTo),
    ...(input.client ? { client: input.client } : {}),
    expiresAt: now.getTime() + UPSTREAM_STATE_TTL_MS,
  };
}

export function upstreamCodeChallenge(state: UpstreamState): string {
  return pkceChallenge(state.codeVerifier);
}

export function sealUpstreamState(state: UpstreamState, secrets: SecretBox): string {
  return secrets.encrypt(JSON.stringify(state));
}

// 복호화하지 못했거나 만료됐거나 콜백의 state와 다르면 null
export function openUpstreamState(
  cookie: string | undefined,
  secrets: SecretBox,
  expectedState: string,
  now: Date,
): UpstreamState | null {
  if (!cookie) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(secrets.decrypt(cookie));
  } catch {
    return null;
  }
  const result = upstreamStateSchema.safeParse(parsed);
  if (!result.success) return null;
  const state = result.data;
  if (state.expiresAt <= now.getTime() || state.state !== expectedState) return null;
  return state;
}
