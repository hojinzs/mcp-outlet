import { describe, expect, it } from 'vitest';
import { accountSwitchMode } from './session.ts';

describe('accountSwitchMode', () => {
  it('IdP 로그아웃을 지원하면 버튼, 아니면 안내', () => {
    expect(accountSwitchMode({ isError: false, data: { idpLogout: true } })).toBe('button');
    expect(accountSwitchMode({ isError: false, data: { idpLogout: false } })).toBe('notice');
  });

  it('옵션을 받지 못하면 안내, 받는 중에는 아무것도 없다', () => {
    expect(accountSwitchMode({ isError: true })).toBe('notice');
    expect(accountSwitchMode({ isError: false })).toBeNull();
  });
});
