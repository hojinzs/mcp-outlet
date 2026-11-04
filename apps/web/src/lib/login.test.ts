import { describe, expect, it } from 'vitest';
import { loginErrorMessage, loginPagePath, loginStartUrl, safeReturnTo } from './login.ts';

describe('returnTo', () => {
  it('/admin/ 아래 경로만 받는다', () => {
    expect(safeReturnTo('/admin/endpoints/1?x=1')).toBe('/admin/endpoints/1?x=1');
    for (const value of [
      null,
      '',
      'https://evil.test/admin/',
      '//evil.test/admin/',
      '/admin',
      '/adminx',
      '/admin/\\evil',
      '/admin/login?returnTo=/admin/',
    ]) {
      expect(safeReturnTo(value), String(value)).toBeUndefined();
    }
  });

  it('세션 만료 시 지금 경로를 붙여 로그인 화면으로', () => {
    expect(loginPagePath('/admin/endpoints/1')).toBe(
      '/admin/login?returnTo=%2Fadmin%2Fendpoints%2F1',
    );
    expect(loginPagePath('/admin/login')).toBe('/admin/login');
  });

  it('로그인 시작 주소는 기본값으로 홈에 돌아온다', () => {
    expect(loginStartUrl(undefined)).toBe('/auth/login?returnTo=%2Fadmin%2F');
    expect(loginStartUrl('/admin/x', 'login')).toBe(
      '/auth/login?returnTo=%2Fadmin%2Fx&prompt=login',
    );
  });
});

describe('로그인 오류 문구', () => {
  it('분류별 고정 문구, 모르는 값은 일반 문구', () => {
    expect(loginErrorMessage(null)).toBeUndefined();
    expect(loginErrorMessage('state_mismatch')).toContain('만료');
    expect(loginErrorMessage('<script>')).toBe('로그인하지 못했습니다. 다시 시도하세요.');
  });
});
