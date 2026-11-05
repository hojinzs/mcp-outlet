import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import type { Db } from '../db/client.ts';
import { testConfig } from '../testing/app.ts';

// 쿠키를 열지 못하는 경우는 DB까지 가지 않는다. 동의부터 콜백까지의 흐름은 builtins.test.ts
describe('업스트림 OAuth 콜백: state 쿠키를 열 수 없음', () => {
  const setup = () => buildApp(testConfig(), {} as Db);

  it('쿠키가 없으면(10분 만료) 홈으로 expired를 보낸다', async () => {
    const app = await setup();
    for (const query of ['code=c&state=s', 'error=access_denied&state=s', '']) {
      const res = await app.inject(`/auth/upstream/callback?${query}`);
      expect(res.statusCode, query).toBe(302);
      expect(res.headers.location, query).toBe('/admin/?connect_error=expired');
    }
  });

  it('쿠키가 있지만 열리지 않으면 failed로 두고 쿠키를 지운다', async () => {
    const app = await setup();
    const res = await app.inject({
      url: '/auth/upstream/callback?code=c&state=s',
      cookies: { outlet_upstream: 'forged' },
    });
    expect(res.headers.location).toBe('/admin/?connect_error=failed');
    expect(res.cookies.find((c) => c.name === 'outlet_upstream')).toMatchObject({
      value: '',
      path: '/auth/upstream',
    });
  });
});
