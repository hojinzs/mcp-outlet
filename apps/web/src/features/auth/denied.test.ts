import { describe, expect, it } from 'vitest';
import { notMemberMessage } from './denied.ts';

describe('접근 거부 문구', () => {
  it('이메일이 있으면 그 계정을, 없으면 "이 계정"을 말한다', () => {
    expect(notMemberMessage('kim@example.com')).toBe(
      'kim@example.com 계정은 MCP Outlet 사용 그룹에 속해 있지 않습니다. 관리자에게 그룹 추가를 요청하세요.',
    );
    expect(notMemberMessage(null)).toMatch(/^이 계정은 MCP Outlet/);
    expect(notMemberMessage('')).toMatch(/^이 계정은 /);
  });
});
