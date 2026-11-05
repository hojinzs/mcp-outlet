import { describe, expect, it } from 'vitest';
import { DENIED_EMAIL_TTL_MS, readDeniedEmail, serializeDeniedEmail } from './denied-email.ts';

const secret = 's'.repeat(32);
const now = new Date('2026-11-06T00:00:00Z');

describe('접근 거부 이메일 쿠키', () => {
  const cookie = serializeDeniedEmail('u@test', secret, now);

  it('서명이 맞고 만료 전이면 이메일을 돌려준다', () => {
    expect(readDeniedEmail(cookie, secret, now)).toBe('u@test');
  });

  it('없거나 서명이 틀리거나 만료되면 null', () => {
    expect(readDeniedEmail(undefined, secret, now)).toBeNull();
    expect(readDeniedEmail(cookie, 't'.repeat(32), now)).toBeNull();
    expect(readDeniedEmail(`${cookie}x`, secret, now)).toBeNull();
    const later = new Date(now.getTime() + DENIED_EMAIL_TTL_MS);
    expect(readDeniedEmail(cookie, secret, later)).toBeNull();
  });
});
