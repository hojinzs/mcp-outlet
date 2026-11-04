import { describe, expect, it } from 'vitest';
import type { Builtin } from '../../api/types.ts';
import {
  initialBuiltinForm,
  oauthProblem,
  serviceAccountProblem,
  toOAuthConnectorInput,
  toServiceAccountInput,
  withBuiltin,
} from './builtin-form.ts';

const ga: Builtin = {
  key: 'google-analytics',
  name: 'Google Analytics 4 + Search Console',
  description: '',
  toolCount: 5,
  authMethods: [
    { type: 'service_account' },
    {
      type: 'oauth2',
      provider: 'Google',
      redirectUri: 'https://outlet.test/auth/upstream/callback',
    },
  ],
};

const keyJson = JSON.stringify({
  type: 'service_account',
  client_email: 'outlet@project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
});

describe('내장 서비스 입력', () => {
  it('서비스를 고르면 이름은 서비스 이름, 방식은 첫 번째 접속 방식', () => {
    const form = withBuiltin(initialBuiltinForm, ga);
    expect(form.name).toBe('Google Analytics 4 + Search Console');
    expect(form.method).toBe('service_account');
  });

  it('고친 이름은 유지하고, 같은 서비스를 다시 고르면 입력을 지우지 않는다', () => {
    const edited = { ...withBuiltin(initialBuiltinForm, ga), name: 'GA', nameEdited: true };
    const withKey = { ...edited, key: keyJson };
    expect(withBuiltin(withKey, ga)).toBe(withKey);
    expect(withBuiltin(withKey, { ...ga, key: 'other' })).toMatchObject({ name: 'GA', key: '' });
  });

  it('서비스 계정은 키와 이름이 맞아야 한다', () => {
    const form = withBuiltin(initialBuiltinForm, ga);
    expect(serviceAccountProblem(initialBuiltinForm)).toBe('내장 서비스를 고르세요.');
    expect(serviceAccountProblem(form)).toBe('서비스 계정 JSON 키를 넣으세요.');
    expect(serviceAccountProblem({ ...form, key: '{' })).toContain('JSON 형식');
    expect(serviceAccountProblem({ ...form, key: keyJson, name: ' ' })).toBe(
      '커넥터 이름은 1~60자입니다.',
    );
    expect(serviceAccountProblem({ ...form, key: keyJson })).toBeUndefined();
  });

  it('OAuth는 Client ID·Secret이 있어야 한다', () => {
    const form = { ...withBuiltin(initialBuiltinForm, ga), method: 'oauth2' as const };
    expect(oauthProblem(form)).toBe('Client ID와 Client Secret을 넣으세요.');
    expect(oauthProblem({ ...form, clientId: 'id', clientSecret: 'secret' })).toBeUndefined();
  });

  it('API 입력으로 바꿀 때 이름과 OAuth 값의 앞뒤 공백을 지운다', () => {
    const form = { ...withBuiltin(initialBuiltinForm, ga), name: ' GA ', nameEdited: true };
    expect(toServiceAccountInput({ ...form, key: keyJson })).toEqual({
      builtin: 'google-analytics',
      name: 'GA',
      auth: { type: 'service_account', key: keyJson },
    });
    expect(toOAuthConnectorInput({ ...form, clientId: ' id ', clientSecret: ' s ' })).toEqual({
      builtin: 'google-analytics',
      name: 'GA',
      auth: { type: 'oauth2', clientId: 'id', clientSecret: 's' },
    });
  });
});
