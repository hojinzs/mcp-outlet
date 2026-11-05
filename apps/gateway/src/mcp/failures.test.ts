import { describe, expect, it } from 'vitest';
import { failureMessage, toolFailureResult } from './failures.ts';

const ADMIN = 'https://outlet.test/admin/endpoints/e1';

describe('toolFailureResult', () => {
  it('고칠 수 있는 실패는 isError 툴 결과에 관리 화면 링크를 담는다', () => {
    for (const kind of [
      'auth_failed',
      'reauth_required',
      'key_rejected',
      'unreachable',
      'redirect',
    ] as const) {
      const result = toolFailureResult(kind, ADMIN);
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: 'text', text: failureMessage(kind, ADMIN) }]);
      expect(result.content[0]?.text).toContain(ADMIN);
    }
  });

  it('일시 장애는 링크 없이 다시 시도를 안내한다', () => {
    expect(failureMessage('timeout', ADMIN)).not.toContain(ADMIN);
    expect(failureMessage('upstream_error', ADMIN)).not.toContain(ADMIN);
  });
});
