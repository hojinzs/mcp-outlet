import { describe, expect, it } from 'vitest';
import { pkceChallenge, randomToken, sha256Hex, signValue, unsignValue } from './tokens.ts';

const secret = 's'.repeat(32);

describe('tokens', () => {
  it('무작위 토큰은 매번 다르다', () => {
    expect(randomToken()).not.toBe(randomToken());
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('SHA-256 hex', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('PKCE S256은 RFC 7636 예시와 같다', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('서명한 값만 되돌린다', () => {
    const signed = signValue('payload.with.dots', secret);
    expect(unsignValue(signed, secret)).toBe('payload.with.dots');
    expect(unsignValue(signed, 't'.repeat(32))).toBeNull();
    expect(unsignValue(`${signed}x`, secret)).toBeNull();
    expect(unsignValue('payload.with.dots', secret)).toBeNull();
    expect(unsignValue('nodot', secret)).toBeNull();
  });
});
