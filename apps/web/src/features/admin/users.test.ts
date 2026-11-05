import { describe, expect, it } from 'vitest';
import type { AdminConnector, AdminUser } from '../../api/types.ts';
import { adminConnectorStatus, disableReasonProblem, filterUsers, userLabel } from './users.ts';

const user = (overrides: Partial<AdminUser>): AdminUser => ({
  id: 'u',
  sub: 'abcdefghijklmnop',
  email: null,
  role: 'user',
  groups: [],
  lastLoginAt: null,
  connectorCount: 0,
  disabledConnectorCount: 0,
  endpointCount: 0,
  lastCalledAt: null,
  ...overrides,
});

const connector = (overrides: Partial<AdminConnector>): AdminConnector => ({
  id: 'c',
  name: 'CMS',
  runtime: 'remote',
  builtin: null,
  url: 'https://cms.test/mcp',
  status: 'ok',
  disabled: null,
  endpointCount: 1,
  lastCalledAt: null,
  createdAt: '2026-11-01T00:00:00Z',
  ...overrides,
});

describe('사용자 목록 규칙 (SCR-ADM-04)', () => {
  it('이메일이 없으면 sub 앞부분을 보여준다', () => {
    expect(userLabel({ email: 'a@test', sub: 'x' })).toBe('a@test');
    expect(userLabel({ email: null, sub: 'abcdefghijklmnop' })).toBe('abcdefghijkl…');
    expect(userLabel({ email: null, sub: 'short' })).toBe('short');
    expect(userLabel({ email: null, sub: null })).toBe('-');
  });

  it('이메일 검색과 사용 중지 필터를 함께 건다', () => {
    const users = [
      user({ id: '1', email: 'Steve@daniworks.test', disabledConnectorCount: 1 }),
      user({ id: '2', email: 'kim@daniworks.test' }),
      user({ id: '3', email: null, sub: 'steve-sub' }),
    ];
    expect(filterUsers(users, ' steve ', 'all').map((u) => u.id)).toEqual(['1', '3']);
    expect(filterUsers(users, '', 'disabled').map((u) => u.id)).toEqual(['1']);
    expect(filterUsers(users, 'kim', 'disabled')).toEqual([]);
  });

  it('커넥터 상태는 사용 중지가 먼저다', () => {
    const disabled = { at: '2026-11-05T00:00:00Z', reason: 'x', by: null };
    expect(adminConnectorStatus(connector({ status: 'error', disabled })).label).toBe(
      '사용 중지됨',
    );
    expect(adminConnectorStatus(connector({ status: 'reauth_required' })).label).toBe(
      '재연결 필요',
    );
    expect(adminConnectorStatus(connector({ status: 'error' })).label).toBe('오류');
    expect(adminConnectorStatus(connector({})).label).toBe('정상');
  });

  it('사용 중지 사유는 필수이고 200자 이내다', () => {
    expect(disableReasonProblem('  ')).toBe('사유를 적으세요');
    expect(disableReasonProblem('a'.repeat(201))).toBe('사유는 200자 이내입니다');
    expect(disableReasonProblem(` ${'a'.repeat(200)} `)).toBeNull();
  });
});
