import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const validEnv = {
  PUBLIC_BASE_URL: 'https://outlet.example.com',
  DATABASE_URL: 'postgres://outlet:outlet@localhost:5432/outlet',
  OIDC_DISCOVERY_URL:
    'https://auth.example.com/application/o/outlet/.well-known/openid-configuration',
  OIDC_CLIENT_ID: 'outlet',
  OIDC_ADMIN_GROUPS: 'outlet-admins, ops',
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

const runner = { RUNNER_URL: 'http://runner:4000', RUNNER_TOKEN: 'x'.repeat(32) };

describe('loadConfig', () => {
  it('기본값과 CSV 목록을 채운다', () => {
    const config = loadConfig(validEnv);
    expect(config.PORT).toBe(3000);
    expect(config.OIDC_ADMIN_GROUPS).toEqual(['outlet-admins', 'ops']);
    expect(config.OIDC_LOGIN_GROUPS).toEqual([]);
  });

  it('빈 값은 지정하지 않은 것으로 본다', () => {
    const config = loadConfig({ ...validEnv, ENCRYPTION_KEY_PREVIOUS: '', OIDC_CLIENT_SECRET: '' });
    expect(config.ENCRYPTION_KEY_PREVIOUS).toBeUndefined();
    expect(config.OIDC_CLIENT_SECRET).toBeUndefined();
  });

  it('32바이트가 아닌 암호화 키를 거부한다', () => {
    expect(() =>
      loadConfig({ ...validEnv, ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/ENCRYPTION_KEY/);
  });

  it('runner 설정 없이도 동작한다', () => {
    const config = loadConfig({ ...validEnv, RUNNER_URL: '' });
    expect(config.RUNNER_URL).toBeUndefined();
    expect(loadConfig({ ...validEnv, ...runner }).RUNNER_URL).toBe(runner.RUNNER_URL);
  });

  it('RUNNER_URL만 있고 토큰이 없으면 거부한다', () => {
    expect(() => loadConfig({ ...validEnv, RUNNER_URL: runner.RUNNER_URL })).toThrow(
      /RUNNER_TOKEN/,
    );
  });

  it('오류 메시지에 값을 노출하지 않는다', () => {
    const secret = 'too-short-secret';
    expect(() => loadConfig({ ...validEnv, ...runner, RUNNER_TOKEN: secret })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(secret) }),
    );
  });
});
