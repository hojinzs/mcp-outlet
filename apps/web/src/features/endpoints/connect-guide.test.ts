import { describe, expect, it } from 'vitest';
import { claudeCodeCommand, serverSlug } from './connect-guide.ts';

describe('Claude Code 명령', () => {
  it('서버 이름은 영문 소문자·숫자·하이픈, 없으면 기본값', () => {
    expect(serverSlug('Home CMS 2')).toBe('home-cms-2');
    expect(serverSlug('  --Fake_MCP!! ')).toBe('fake-mcp');
    expect(serverSlug('홈 CMS')).toBe('cms');
    expect(serverSlug('읽기 전용')).toBe('mcp-outlet');
  });

  it('secret 값은 넣지 않고, Confidential client면 --client-secret으로 묻게 한다', () => {
    const url = 'https://outlet.test/c/1/mcp';
    expect(
      claudeCodeCommand({ name: 'Home CMS', url, clientId: 'cid', hasClientSecret: true }),
    ).toBe(
      `claude mcp add --transport http --client-id cid --client-secret --callback-port 8765 home-cms ${url}`,
    );
    expect(
      claudeCodeCommand({ name: 'x', url, clientId: 'cid', hasClientSecret: false }),
    ).not.toContain('--client-secret');
  });
});
