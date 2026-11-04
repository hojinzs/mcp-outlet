import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// PKCE S256 (RFC 7636)
export function pkceChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

function hmac(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function signValue(value: string, secret: string): string {
  return `${value}.${hmac(value, secret)}`;
}

// 서명이 맞으면 원래 값, 아니면 null
export function unsignValue(signed: string, secret: string): string | null {
  const dot = signed.lastIndexOf('.');
  if (dot < 0) return null;
  const value = signed.slice(0, dot);
  const actual = Buffer.from(signed.slice(dot + 1));
  const expected = Buffer.from(hmac(value, secret));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return value;
}
