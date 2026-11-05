import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { JWTPayload } from 'jose';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import { sha256Hex } from '../crypto/tokens.ts';
import { sessions, users } from '../db/schema.ts';
import { createAuthGuards } from '../http/auth-guard.ts';
import { testDatabaseUrl, useTestDb } from '../testing/db.ts';
import {
  createFakeIdp,
  FAKE_CLIENT_ID,
  FAKE_CLIENT_SECRET,
  FAKE_DISCOVERY_URL,
  FAKE_ISSUER,
} from '../testing/fake-idp.ts';

const HOUR = 60 * 60 * 1000;

function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    PUBLIC_BASE_URL: 'https://outlet.test',
    DATABASE_URL: testDatabaseUrl ?? 'postgres://unused',
    OIDC_DISCOVERY_URL: FAKE_DISCOVERY_URL,
    OIDC_CLIENT_ID: FAKE_CLIENT_ID,
    OIDC_CLIENT_SECRET: FAKE_CLIENT_SECRET,
    OIDC_LOGIN_GROUPS: 'Outlet Users,Outlet Admins',
    OIDC_ADMIN_GROUPS: 'Outlet Admins',
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    SESSION_SECRET: 's'.repeat(32),
    SESSION_TTL_HOURS: '1',
    LOG_LEVEL: 'fatal',
    ...overrides,
  });
}

describe.skipIf(!testDatabaseUrl)('관리 UI 로그인 (DB)', () => {
  const db = useTestDb();

  async function setup(options: { endSession?: boolean } = {}) {
    let current = new Date('2026-11-04T00:00:00Z');
    const now = () => current;
    const idp = await createFakeIdp({ now, ...options });
    const app = await buildApp(testConfig(), db, { fetch: idp.fetch, now });
    // 관리자 API가 아직 없으므로 같은 가드로 시험용 라우트를 붙인다
    const guards = createAuthGuards({ db, now });
    app.get(
      '/api/test-admin',
      { preHandler: [guards.requireSession, guards.requireAdmin] },
      async () => ({ ok: true }),
    );
    const advance = (ms: number) => {
      current = new Date(current.getTime() + ms);
    };
    return { app, idp, advance };
  }

  type Setup = Awaited<ReturnType<typeof setup>>;

  async function startLogin({ app }: Setup, query = '') {
    const res = await app.inject(`/auth/login${query}`);
    const location = res.headers.location ?? '';
    const loginCookie = res.cookies.find((c) => c.name === 'outlet_login');
    return { res, location, loginCookie, state: new URL(location).searchParams.get('state') };
  }

  async function login(s: Setup, claims: JWTPayload, query = '') {
    const start = await startLogin(s, query);
    const code = s.idp.authorize(start.location, claims);
    return s.app.inject({
      url: `/auth/callback?code=${code}&state=${start.state}`,
      cookies: { outlet_login: start.loginCookie?.value ?? '' },
    });
  }

  function sessionCookie(res: { cookies: { name: string; value: string }[] }) {
    return res.cookies.find((c) => c.name === 'outlet_session')?.value;
  }

  const member = () => ({ sub: `sub-${randomUUID()}`, email: 'u@test', groups: ['Outlet Users'] });
  const admin = () => ({ ...member(), groups: ['Outlet Users', 'Outlet Admins'] });

  it('로그인 시작은 PKCE S256과 서명한 임시 쿠키를 쓴다', async () => {
    const s = await setup();
    const { res, location, loginCookie } = await startLogin(s, '?prompt=login');
    // prompt는 IdP에 넘기지 않는다. "다른 계정으로 로그인"은 end_session으로 한다
    expect(res.statusCode).toBe(302);
    const params = new URL(location).searchParams;
    expect(location.startsWith(`${FAKE_ISSUER}/authorize?`)).toBe(true);
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('redirect_uri')).toBe('https://outlet.test/auth/callback');
    expect(params.has('prompt')).toBe(false);
    expect(loginCookie).toMatchObject({
      httpOnly: true,
      sameSite: 'Lax',
      secure: true,
      path: '/auth',
    });
  });

  it('콜백 성공: 세션 쿠키를 주고 returnTo로 보내며 /api/me가 200', async () => {
    const s = await setup();
    const claims = member();
    const res = await login(s, claims, '?returnTo=%2Fadmin%2Fendpoints%2F1');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/admin/endpoints/1');
    const cookie = res.cookies.find((c) => c.name === 'outlet_session');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', secure: true, path: '/' });

    const me = await s.app.inject({
      url: '/api/me',
      cookies: { outlet_session: cookie?.value ?? '' },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({
      id: expect.any(String),
      email: 'u@test',
      role: 'user',
      groups: ['Outlet Users'],
    });
    const [user] = await db.select().from(users).where(eq(users.sub, claims.sub));
    expect(user?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('외부 returnTo는 버리고 /admin/으로 보낸다', async () => {
    const s = await setup();
    const res = await login(s, member(), '?returnTo=https%3A%2F%2Fevil.example');
    expect(res.headers.location).toBe('/admin/');
  });

  it('허용 그룹 밖이면 세션 없이 접근 거부로 보낸다', async () => {
    const s = await setup();
    const claims = { ...member(), groups: ['Someone Else'] };
    const res = await login(s, claims);
    expect(res.statusCode).toBe(302);
    // 이메일은 주소에 싣지 않는다
    expect(res.headers.location).toBe('/admin/forbidden?reason=not_member');
    expect(sessionCookie(res)).toBeUndefined();
    expect(await db.select().from(users).where(eq(users.sub, claims.sub))).toHaveLength(0);
  });

  it('접근 거부 화면은 서명 쿠키로 이메일을 받고, 10분이 지나거나 위조하면 null', async () => {
    const s = await setup();
    const res = await login(s, { ...member(), groups: ['Someone Else'] });
    const denied = res.cookies.find((c) => c.name === 'outlet_denied');
    expect(denied).toMatchObject({
      httpOnly: true,
      sameSite: 'Lax',
      secure: true,
      path: '/auth/denied',
      maxAge: 600,
    });
    expect(denied?.value).not.toContain('u@test');
    const read = (value: string) =>
      s.app.inject({ url: '/auth/denied', cookies: { outlet_denied: value } });

    const ok = await read(denied?.value ?? '');
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ email: 'u@test' });
    expect((await s.app.inject('/auth/denied')).json()).toEqual({ email: null });
    // 다른 이메일에 원래 서명을 붙여도 받지 않는다
    const signature = (denied?.value ?? '').split('.').at(-1);
    const forged = Buffer.from(JSON.stringify({ email: 'x@evil', expiresAt: 9e15 })).toString(
      'base64url',
    );
    expect((await read(`${forged}.${signature}`)).json()).toEqual({ email: null });
    s.advance(10 * 60 * 1000);
    expect((await read(denied?.value ?? '')).json()).toEqual({ email: null });
  });

  it('이메일 없이 거부되거나 로그인에 성공하면 이전 거부 쿠키를 지운다', async () => {
    const s = await setup();
    const noEmail = await login(s, { sub: `sub-${randomUUID()}`, groups: [] });
    expect(noEmail.headers.location).toBe('/admin/forbidden?reason=not_member');
    expect(noEmail.cookies.find((c) => c.name === 'outlet_denied')).toMatchObject({
      value: '',
      path: '/auth/denied',
    });
    const ok = await login(s, member());
    expect(ok.cookies.find((c) => c.name === 'outlet_denied')).toMatchObject({
      value: '',
      path: '/auth/denied',
    });
  });

  it('state 위조·임시 쿠키 없음은 state_mismatch', async () => {
    const s = await setup();
    const start = await startLogin(s);
    const code = s.idp.authorize(start.location, member());
    const forged = await s.app.inject({
      url: `/auth/callback?code=${code}&state=forged`,
      cookies: { outlet_login: start.loginCookie?.value ?? '' },
    });
    expect(forged.headers.location).toBe('/admin/login?error=state_mismatch');
    expect(sessionCookie(forged)).toBeUndefined();

    const noCookie = await s.app.inject(`/auth/callback?code=${code}&state=${start.state}`);
    expect(noCookie.headers.location).toBe('/admin/login?error=state_mismatch');
  });

  it('임시 쿠키가 만료되면 state_mismatch', async () => {
    const s = await setup();
    const start = await startLogin(s);
    const code = s.idp.authorize(start.location, member());
    s.advance(11 * 60 * 1000);
    const res = await s.app.inject({
      url: `/auth/callback?code=${code}&state=${start.state}`,
      cookies: { outlet_login: start.loginCookie?.value ?? '' },
    });
    expect(res.headers.location).toBe('/admin/login?error=state_mismatch');
  });

  it('IdP 오류는 분류값만 넘긴다', async () => {
    const s = await setup();
    const denied = await s.app.inject('/auth/callback?error=access_denied&error_description=x');
    expect(denied.headers.location).toBe('/admin/login?error=access_denied');
    const other = await s.app.inject('/auth/callback?error=server_error&error_description=secret');
    expect(other.headers.location).toBe('/admin/login?error=idp_error');
  });

  it('코드 교환이 실패하면 idp_error', async () => {
    const s = await setup();
    const start = await startLogin(s);
    const res = await s.app.inject({
      url: `/auth/callback?code=unknown&state=${start.state}`,
      cookies: { outlet_login: start.loginCookie?.value ?? '' },
    });
    expect(res.headers.location).toBe('/admin/login?error=idp_error');
  });

  it('세션이 없거나 만료되거나 지워지면 401', async () => {
    const s = await setup();
    expect((await s.app.inject('/api/me')).json()).toMatchObject({
      error: { code: 'unauthorized' },
      requestId: expect.any(String),
    });

    const token = sessionCookie(await login(s, member())) ?? '';
    const me = () => s.app.inject({ url: '/api/me', cookies: { outlet_session: token } });
    expect((await me()).statusCode).toBe(200);
    s.advance(HOUR);
    expect((await me()).statusCode).toBe(401);

    const other = sessionCookie(await login(s, member())) ?? '';
    await db.delete(sessions).where(eq(sessions.tokenHash, sha256Hex(other)));
    const res = await s.app.inject({ url: '/api/me', cookies: { outlet_session: other } });
    expect(res.statusCode).toBe(401);
  });

  it('로그아웃하면 세션이 지워져 401', async () => {
    const s = await setup();
    const token = sessionCookie(await login(s, member())) ?? '';
    const out = await s.app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { outlet_session: token },
    });
    expect(out.json()).toEqual({ redirectTo: '/admin/login' });
    expect(out.cookies.find((c) => c.name === 'outlet_session')?.value).toBe('');
    const me = await s.app.inject({ url: '/api/me', cookies: { outlet_session: token } });
    expect(me.statusCode).toBe(401);
  });

  it('idp=true면 id_token_hint를 붙인 end_session 주소를, IdP가 지원하지 않으면 로그인 화면을 준다', async () => {
    const s = await setup();
    const callback = await login(s, member());
    const idTokenCookie = callback.cookies.find((c) => c.name === 'outlet_id_token');
    expect(idTokenCookie).toMatchObject({ httpOnly: true, secure: true, path: '/auth/logout' });
    const out = await s.app.inject({
      method: 'POST',
      url: '/auth/logout?idp=true',
      cookies: { outlet_id_token: idTokenCookie?.value ?? '' },
    });
    const url = new URL(out.json().redirectTo);
    expect(`${url.origin}${url.pathname}`).toBe(`${FAKE_ISSUER}/end-session`);
    expect(url.searchParams.get('id_token_hint')).toBe(idTokenCookie?.value);
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(
      'https://outlet.test/admin/login',
    );
    expect(out.cookies.find((c) => c.name === 'outlet_id_token')?.value).toBe('');

    // 허용 그룹 밖이라 세션이 없어도 "다른 계정으로 로그인"에 hint를 쓸 수 있다
    const denied = await login(s, { ...member(), groups: [] });
    expect(denied.cookies.find((c) => c.name === 'outlet_id_token')?.value).toBeTruthy();

    const bare = await setup({ endSession: false });
    const res = await bare.app.inject({ method: 'POST', url: '/auth/logout?idp=true' });
    expect(res.json()).toEqual({ redirectTo: '/admin/login' });
  });

  it('IdP 로그아웃 지원 여부는 세션 없이도 받는다', async () => {
    const s = await setup();
    const supported = await s.app.inject('/auth/options');
    expect(supported.statusCode).toBe(200);
    expect(supported.json()).toEqual({ idpLogout: true });

    const bare = await setup({ endSession: false });
    expect((await bare.app.inject('/auth/options')).json()).toEqual({ idpLogout: false });
  });

  it('관리자 API는 user에게 403, admin에게 200', async () => {
    const s = await setup();
    const userToken = sessionCookie(await login(s, member())) ?? '';
    const asUser = await s.app.inject({
      url: '/api/test-admin',
      cookies: { outlet_session: userToken },
    });
    expect(asUser.statusCode).toBe(403);
    expect(asUser.json().error.code).toBe('forbidden');

    const adminToken = sessionCookie(await login(s, admin())) ?? '';
    const asAdmin = await s.app.inject({
      url: '/api/test-admin',
      cookies: { outlet_session: adminToken },
    });
    expect(asAdmin.statusCode).toBe(200);
  });

  it('role은 매 요청 DB 값을 쓴다', async () => {
    const s = await setup();
    const claims = admin();
    const token = sessionCookie(await login(s, claims)) ?? '';
    await db.update(users).set({ role: 'user' }).where(eq(users.sub, claims.sub));
    const res = await s.app.inject({ url: '/api/test-admin', cookies: { outlet_session: token } });
    expect(res.statusCode).toBe(403);
  });
});
