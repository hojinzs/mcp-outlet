import { describe, expect, it } from 'vitest';
import {
  createLoginState,
  LOGIN_STATE_TTL_MS,
  readLoginState,
  safeReturnTo,
  serializeLoginState,
} from './login-state.ts';

const secret = 's'.repeat(32);
const now = new Date('2026-11-04T00:00:00Z');

describe('safeReturnTo', () => {
  it('/admin/ 아래 경로만 받는다', () => {
    expect(safeReturnTo('/admin/endpoints/1')).toBe('/admin/endpoints/1');
    for (const bad of [
      undefined,
      '',
      'https://evil.example',
      '//evil.example',
      '/api/me',
      '/admin',
      '/admin/\\evil',
    ]) {
      expect(safeReturnTo(bad)).toBe('/admin/');
    }
  });
});

describe('login state 쿠키', () => {
  const loginState = createLoginState('/admin/x', now);
  const cookie = serializeLoginState(loginState, secret);

  it('같은 state면 되돌린다', () => {
    expect(readLoginState(cookie, secret, loginState.state, now)).toEqual(loginState);
  });

  it('state가 다르거나 서명이 틀리면 null', () => {
    expect(readLoginState(cookie, secret, 'forged', now)).toBeNull();
    expect(readLoginState(cookie, 't'.repeat(32), loginState.state, now)).toBeNull();
    expect(readLoginState(undefined, secret, loginState.state, now)).toBeNull();
  });

  it('만료되면 null', () => {
    const later = new Date(now.getTime() + LOGIN_STATE_TTL_MS);
    expect(readLoginState(cookie, secret, loginState.state, later)).toBeNull();
  });
});
