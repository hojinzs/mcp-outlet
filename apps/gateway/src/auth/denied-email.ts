import { z } from 'zod';
import { signValue, unsignValue } from '../crypto/tokens.ts';

// 접근 거부 화면(SCR-COM-03 not_member)의 문구에만 쓰는 이메일.
// 주소에 실으면 프록시 로그·브라우저 기록에 남고 아무 값이나 넣을 수 있어 SESSION_SECRET으로 서명한 쿠키에 담는다
const deniedEmailSchema = z.object({ email: z.string(), expiresAt: z.number().int() });

export const DENIED_EMAIL_TTL_MS = 10 * 60 * 1000;

export function serializeDeniedEmail(email: string, secret: string, now: Date): string {
  const payload = { email, expiresAt: now.getTime() + DENIED_EMAIL_TTL_MS };
  return signValue(Buffer.from(JSON.stringify(payload)).toString('base64url'), secret);
}

// 서명이 틀리거나 만료됐으면 null
export function readDeniedEmail(
  cookie: string | undefined,
  secret: string,
  now: Date,
): string | null {
  if (!cookie) return null;
  const encoded = unsignValue(cookie, secret);
  if (!encoded) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString());
  } catch {
    return null;
  }
  const result = deniedEmailSchema.safeParse(parsed);
  if (!result.success || result.data.expiresAt <= now.getTime()) return null;
  return result.data.email;
}
