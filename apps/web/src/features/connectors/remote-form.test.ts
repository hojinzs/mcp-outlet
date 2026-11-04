import { describe, expect, it } from 'vitest';
import {
  connectionTestMessage,
  initialRemoteForm,
  remoteFormProblem,
  toRemoteInput,
  withUrl,
} from './remote-form.ts';

describe('원격 커넥터 입력', () => {
  it('이름은 고치기 전까지 주소의 호스트 이름을 따라간다', () => {
    const typed = withUrl(initialRemoteForm, 'https://cms.example.com/mcp');
    expect(typed.name).toBe('cms.example.com');
    const edited = withUrl({ ...typed, name: 'Home CMS', nameEdited: true }, 'https://x.test/mcp');
    expect(edited.name).toBe('Home CMS');
  });

  it('주소·이름·토큰이 없으면 문제를 알려준다', () => {
    expect(remoteFormProblem(initialRemoteForm)).toBeDefined();
    const form = withUrl(initialRemoteForm, 'https://cms.example.com/mcp');
    expect(remoteFormProblem(form)).toBe('토큰을 넣으세요.');
    expect(remoteFormProblem({ ...form, authType: 'none' })).toBeUndefined();
    expect(remoteFormProblem(withUrl(initialRemoteForm, 'ftp://x.test'))).toBeDefined();
  });

  it('API 입력으로 바꿀 때 인증 없음이면 토큰을 보내지 않는다', () => {
    const form = { ...withUrl(initialRemoteForm, ' https://x.test/mcp '), token: 'secret' };
    expect(toRemoteInput({ ...form, authType: 'none' })).toEqual({
      name: 'x.test',
      url: 'https://x.test/mcp',
      auth: { type: 'none' },
    });
    expect(toRemoteInput(form).auth).toEqual({
      type: 'static_token',
      token: 'secret',
      header: 'Authorization',
      prefix: 'Bearer ',
    });
  });

  it('연결 테스트 실패는 분류별 문구, 모르는 분류는 일반 문구', () => {
    expect(connectionTestMessage('private_address')).toContain('내부망');
    expect(connectionTestMessage('weird')).toContain('실패');
  });
});
