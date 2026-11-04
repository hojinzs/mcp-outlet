import { describe, expect, it } from 'vitest';
import { decideAccess, extractGroups } from './access.ts';

const policy = { groupsClaim: 'groups', loginGroups: ['Users', 'Admins'], adminGroups: ['Admins'] };

describe('extractGroups', () => {
  it('배열·문자열·누락을 처리한다', () => {
    expect(extractGroups({ groups: ['a', 1, 'b'] }, 'groups')).toEqual(['a', 'b']);
    expect(extractGroups({ roles: 'a' }, 'roles')).toEqual(['a']);
    expect(extractGroups({}, 'groups')).toEqual([]);
  });
});

describe('decideAccess', () => {
  it('허용 그룹 밖이면 거부한다', () => {
    expect(decideAccess(['Other'], policy)).toEqual({ allowed: false });
    expect(decideAccess([], policy)).toEqual({ allowed: false });
  });

  it('관리자 그룹이면 admin, 아니면 user', () => {
    expect(decideAccess(['Users'], policy)).toEqual({ allowed: true, role: 'user' });
    expect(decideAccess(['Admins'], policy)).toEqual({ allowed: true, role: 'admin' });
  });

  it('로그인 그룹이 비면 모두 허용한다', () => {
    const open = { ...policy, loginGroups: [] };
    expect(decideAccess([], open)).toEqual({ allowed: true, role: 'user' });
    expect(decideAccess(['Admins'], open)).toEqual({ allowed: true, role: 'admin' });
  });

  it('관리자 그룹이어도 로그인 그룹 밖이면 거부한다', () => {
    const strict = { ...policy, loginGroups: ['Users'] };
    expect(decideAccess(['Admins'], strict)).toEqual({ allowed: false });
  });
});
