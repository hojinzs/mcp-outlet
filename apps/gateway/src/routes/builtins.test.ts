import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { deleteStalePendingConnectors } from '../db/queries/connectors.ts';
import { auditLogs, connectors } from '../db/schema.ts';
import { createLoggedInUser, TEST_GROUPS, testConfig } from '../testing/app.ts';
import { testDatabaseUrl, useTestDb } from '../testing/db.ts';
import {
  createFakeGoogle,
  FAKE_GOOGLE_EMAIL,
  FAKE_OAUTH_CLIENT,
  FAKE_SERVICE_ACCOUNT_EMAIL,
  type FakeGoogle,
} from '../testing/fake-google.ts';
import { createFakeIdp } from '../testing/fake-idp.ts';

type LoggedIn = Awaited<ReturnType<typeof createLoggedInUser>>;

describe.skipIf(!testDatabaseUrl)('내장 커넥터 API·업스트림 OAuth·MCP (DB)', () => {
  const db = useTestDb();
  let clock = new Date();
  const now = () => clock;
  let google: FakeGoogle;
  let idp: Awaited<ReturnType<typeof createFakeIdp>>;
  let app: FastifyInstance;

  beforeAll(async () => {
    google = await createFakeGoogle({ now });
    idp = await createFakeIdp({ now });
    app = await buildApp(testConfig(), db, { fetch: idp.fetch, apiFetch: google.fetch, now });
  });
  afterAll(() => app.close());

  const serviceAccountConnector = () => ({
    builtin: 'google-analytics',
    name: 'GA',
    auth: { type: 'service_account', key: google.serviceAccountKey },
  });

  async function mcpCall(user: LoggedIn, endpointId: string, body: unknown) {
    const token = await idp.signIdToken({ sub: user.sub, groups: [TEST_GROUPS.users] });
    const res = await app.inject({
      method: 'POST',
      url: `/c/${endpointId}/mcp`,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: JSON.stringify(body),
    });
    return res;
  }

  const runReport = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'ga4_run_report',
      arguments: {
        propertyId: '123',
        startDate: '7daysAgo',
        endDate: 'today',
        metrics: ['sessions'],
      },
    },
  };

  async function auditResults(endpointId: string) {
    const rows = await db
      .select({ toolName: auditLogs.toolName, result: auditLogs.result })
      .from(auditLogs)
      .where(eq(auditLogs.endpointId, endpointId));
    return rows;
  }

  // 감사 로그는 응답 뒤에 기록된다
  async function waitForAudit(endpointId: string, count: number) {
    for (let i = 0; i < 50; i += 1) {
      const rows = await auditResults(endpointId);
      if (rows.length >= count) return rows;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return auditResults(endpointId);
  }

  it('내장 서비스 목록: 접속 방식(서비스 계정 먼저)과 리디렉션 URI', async () => {
    const user = await createLoggedInUser(db, now());
    const res = await app.inject({ method: 'GET', url: '/api/builtins', cookies: user.cookies });
    expect(res.statusCode).toBe(200);
    expect(res.json().builtins).toEqual([
      expect.objectContaining({
        key: 'google-analytics',
        toolCount: 8,
        authMethods: [
          { type: 'service_account' },
          {
            type: 'oauth2',
            provider: 'Google',
            redirectUri: 'https://outlet.test/auth/upstream/callback',
          },
        ],
      }),
    ]);
  });

  it('서비스 계정: 연결 테스트 → 엔드포인트 생성 → MCP runReport 성공과 감사 로그', async () => {
    const user = await createLoggedInUser(db, now());
    const test = await app.inject({
      method: 'POST',
      url: '/api/connectors/test',
      cookies: user.cookies,
      payload: serviceAccountConnector(),
    });
    expect(test.json()).toMatchObject({ result: 'ok' });
    expect(test.json().tools).toHaveLength(8);

    const bad = await app.inject({
      method: 'POST',
      url: '/api/connectors/test',
      cookies: user.cookies,
      payload: { ...serviceAccountConnector(), auth: { type: 'service_account', key: '{}' } },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.details).toEqual({ field: 'key' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/endpoints',
      cookies: user.cookies,
      payload: {
        name: 'GA',
        allowedTools: ['ga4_run_report'],
        connector: serviceAccountConnector(),
      },
    });
    expect(created.statusCode).toBe(201);
    const endpoint = created.json();
    // 목록이 서비스 이름을 찾을 수 있게 builtin key를 준다 (SCR-EP-01)
    expect(endpoint.connector).toMatchObject({ runtime: 'builtin', builtin: 'google-analytics' });

    // client_email만 보여주고 private key는 내려주지 않는다
    const connector = await app.inject({
      method: 'GET',
      url: `/api/connectors/${endpoint.connector.id}`,
      cookies: user.cookies,
    });
    expect(connector.json()).toMatchObject({
      runtime: 'builtin',
      builtin: 'google-analytics',
      auth: { type: 'service_account' },
      credential: { configured: true, account: FAKE_SERVICE_ACCOUNT_EMAIL },
    });
    expect(connector.body).not.toContain('PRIVATE KEY');

    const list = await mcpCall(user, endpoint.id, { jsonrpc: '2.0', id: 0, method: 'tools/list' });
    expect(list.json().result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'ga4_run_report',
    ]);

    const call = await mcpCall(user, endpoint.id, runReport);
    expect(call.statusCode).toBe(200);
    const result = call.json().result;
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({ columns: ['date', 'sessions'] });
    expect(await waitForAudit(endpoint.id, 1)).toEqual([
      { toolName: 'ga4_run_report', result: 'ok' },
    ]);

    // 상태 없는 서버라 GET 스트림은 405
    const token = await idp.signIdToken({ sub: user.sub, groups: [TEST_GROUPS.users] });
    const get = await app.inject({
      method: 'GET',
      url: `/c/${endpoint.id}/mcp`,
      headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
    });
    expect(get.statusCode).toBe(405);
  });

  async function startOAuth(user: LoggedIn, connectorId: string, returnTo: string) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/connectors/${connectorId}/oauth/start`,
      cookies: user.cookies,
      payload: { returnTo },
    });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((item) => item.name === 'outlet_upstream');
    if (!cookie) throw new Error('no state cookie');
    expect(cookie).toMatchObject({ path: '/auth/upstream', httpOnly: true, sameSite: 'Lax' });
    return { authorizationUrl: new URL(res.json().authorizationUrl), cookie: cookie.value };
  }

  function callback(user: LoggedIn, cookie: string, query: Record<string, string>) {
    return app.inject({
      method: 'GET',
      url: `/auth/upstream/callback?${new URLSearchParams(query)}`,
      cookies: { ...user.cookies, outlet_upstream: cookie },
    });
  }

  async function pendingOAuthConnector(user: LoggedIn) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/connectors',
      cookies: user.cookies,
      payload: {
        builtin: 'google-analytics',
        name: 'GA OAuth',
        auth: { type: 'oauth2', ...FAKE_OAUTH_CLIENT },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'pending', auth: { type: 'oauth2' } });
    return res.json().id as string;
  }

  it('OAuth: 연결 중 저장 → 동의 → 콜백 → 연결 테스트 → 엔드포인트 → 갱신 실패 시 재연결 안내', async () => {
    const user = await createLoggedInUser(db, now());
    const connectorId = await pendingOAuthConnector(user);
    const returnTo = `/admin/endpoints/new?connector=${connectorId}`;
    const { authorizationUrl, cookie } = await startOAuth(user, connectorId, returnTo);
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(Object.fromEntries(authorizationUrl.searchParams)).toMatchObject({
      client_id: FAKE_OAUTH_CLIENT.clientId,
      redirect_uri: 'https://outlet.test/auth/upstream/callback',
      access_type: 'offline',
      prompt: 'consent',
      code_challenge_method: 'S256',
      response_type: 'code',
    });
    expect(authorizationUrl.searchParams.get('scope')).toContain('analytics.readonly');

    const state = authorizationUrl.searchParams.get('state') ?? '';
    const code = google.consent(authorizationUrl.toString());
    const done = await callback(user, cookie, { code, state });
    expect(done.statusCode).toBe(302);
    expect(done.headers.location).toBe(`${returnTo}&connected=1`);

    const saved = await app.inject({
      method: 'GET',
      url: `/api/connectors/${connectorId}`,
      cookies: user.cookies,
    });
    expect(saved.json()).toMatchObject({
      status: 'pending',
      credential: { configured: true, account: FAKE_GOOGLE_EMAIL },
    });
    expect(saved.body).not.toContain(FAKE_OAUTH_CLIENT.clientSecret);

    const test = await app.inject({
      method: 'POST',
      url: `/api/connectors/${connectorId}/test`,
      cookies: user.cookies,
    });
    expect(test.json().result).toBe('ok');

    const created = await app.inject({
      method: 'POST',
      url: '/api/endpoints',
      cookies: user.cookies,
      payload: { name: 'GA', allowedTools: ['ga4_run_report'], connectorId },
    });
    expect(created.statusCode).toBe(201);
    const endpointId = created.json().id as string;
    const ok = await mcpCall(user, endpointId, runReport);
    expect(ok.json().result.isError).toBeUndefined();

    // 사용자가 Google에서 접근을 취소했고, access token도 만료됐다
    google.revokeRefreshTokens();
    // 만료 1분 전부터 갱신한다. 관리 UI 세션(1시간)은 아직 살아 있다
    clock = new Date(clock.getTime() + 3600_000 - 30_000);
    const failed = await mcpCall(user, endpointId, runReport);
    const result = failed.json().result;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(
      `다시 연결하세요: https://outlet.test/admin/endpoints/${endpointId}`,
    );
    const [row] = await db
      .select({ status: connectors.status })
      .from(connectors)
      .where(eq(connectors.id, connectorId));
    expect(row?.status).toBe('reauth_required');
    const endpoint = await app.inject({
      method: 'GET',
      url: `/api/endpoints/${endpointId}`,
      cookies: user.cookies,
    });
    expect(endpoint.json().status).toBe('reauth_required');
    expect(await waitForAudit(endpointId, 2)).toEqual([
      { toolName: 'ga4_run_report', result: 'ok' },
      { toolName: 'ga4_run_report', result: 'error' },
    ]);

    // 다시 연결하면 상세 화면으로 돌아오고 상태가 풀린다
    const again = await startOAuth(user, connectorId, `/admin/endpoints/${endpointId}`);
    const reconnect = await callback(user, again.cookie, {
      code: google.consent(again.authorizationUrl.toString()),
      state: again.authorizationUrl.searchParams.get('state') ?? '',
    });
    expect(reconnect.headers.location).toBe(`/admin/endpoints/${endpointId}?connected=1`);
    const recovered = await mcpCall(user, endpointId, runReport);
    expect(recovered.json().result.isError).toBeUndefined();
  });

  it('OAuth 재연결: 연결 테스트를 통과해야 상태를 ok로 바꾼다', async () => {
    const user = await createLoggedInUser(db, now());
    const connectorId = await pendingOAuthConnector(user);
    const reconnect = async () => {
      const started = await startOAuth(user, connectorId, '/admin/');
      const res = await callback(user, started.cookie, {
        code: google.consent(started.authorizationUrl.toString()),
        state: started.authorizationUrl.searchParams.get('state') ?? '',
      });
      const [row] = await db
        .select({ status: connectors.status })
        .from(connectors)
        .where(eq(connectors.id, connectorId));
      return { location: res.headers.location, status: row?.status };
    };
    // 처음 연결은 화면의 연결 테스트가 끝날 때까지 연결 중이다
    expect(await reconnect()).toEqual({ location: '/admin/?connected=1', status: 'pending' });
    await db
      .update(connectors)
      .set({ status: 'reauth_required' })
      .where(eq(connectors.id, connectorId));

    google.setApiDenied(true);
    const denied = await reconnect();
    google.setApiDenied(false);
    expect(denied.location).toBe('/admin/?connect_error=test_failed');
    expect(denied.status).not.toBe('ok');

    expect(await reconnect()).toEqual({ location: '/admin/?connected=1', status: 'ok' });
  });

  it('OAuth 첫 연결 테스트가 실패해도 연결 중으로 남아 24시간 뒤 정리된다', async () => {
    const user = await createLoggedInUser(db, now());
    const connectorId = await pendingOAuthConnector(user);
    const started = await startOAuth(user, connectorId, '/admin/');
    await callback(user, started.cookie, {
      code: google.consent(started.authorizationUrl.toString()),
      state: started.authorizationUrl.searchParams.get('state') ?? '',
    });
    google.setApiDenied(true);
    const test = await app.inject({
      method: 'POST',
      url: `/api/connectors/${connectorId}/test`,
      cookies: user.cookies,
    });
    google.setApiDenied(false);
    expect(test.json().result).not.toBe('ok');
    const status = async () =>
      (
        await db
          .select({ status: connectors.status, lastTestResult: connectors.lastTestResult })
          .from(connectors)
          .where(eq(connectors.id, connectorId))
      )[0];
    expect(await status()).toEqual({ status: 'pending', lastTestResult: test.json().result });

    await deleteStalePendingConnectors(db, new Date(now().getTime() + 24 * 3600_000 + 1));
    expect(await status()).toBeUndefined();
  });

  it('OAuth 콜백: 동의 취소, state 불일치, 다른 사용자 세션은 연결하지 않는다', async () => {
    const user = await createLoggedInUser(db, now());
    const connectorId = await pendingOAuthConnector(user);
    const returnTo = `/admin/endpoints/new?connector=${connectorId}`;

    const first = await startOAuth(user, connectorId, returnTo);
    const state = first.authorizationUrl.searchParams.get('state') ?? '';
    const cancelled = await callback(user, first.cookie, { error: 'access_denied', state });
    expect(cancelled.headers.location).toBe(`${returnTo}&connect_error=cancelled`);

    const second = await startOAuth(user, connectorId, returnTo);
    const code = google.consent(second.authorizationUrl.toString());
    const mismatch = await callback(user, second.cookie, { code, state: 'other' });
    expect(mismatch.headers.location).toBe('/admin/?connect_error=failed');

    const stranger = await createLoggedInUser(db, now());
    const third = await startOAuth(user, connectorId, returnTo);
    const stolen = await callback(stranger, third.cookie, {
      code: google.consent(third.authorizationUrl.toString()),
      state: third.authorizationUrl.searchParams.get('state') ?? '',
    });
    expect(stolen.headers.location).toBe(`${returnTo}&connect_error=failed`);

    const connector = await app.inject({
      method: 'GET',
      url: `/api/connectors/${connectorId}`,
      cookies: user.cookies,
    });
    expect(connector.json().credential.account).toBeNull();

    // 다른 사람의 커넥터로는 동의를 시작할 수 없다
    const foreign = await app.inject({
      method: 'POST',
      url: `/api/connectors/${connectorId}/oauth/start`,
      cookies: stranger.cookies,
      payload: {},
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('서비스 계정 키 교체: 연결 테스트를 통과해야 저장하고 키는 응답에 없다', async () => {
    const user = await createLoggedInUser(db, now());
    const connectorId = await pendingOAuthConnector(user);
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/connectors/${connectorId}`,
      cookies: user.cookies,
      payload: { auth: { type: 'service_account', key: google.serviceAccountKey } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      status: 'ok',
      auth: { type: 'service_account' },
      credential: { account: FAKE_SERVICE_ACCOUNT_EMAIL },
    });
    expect(patched.body).not.toContain('PRIVATE KEY');

    const url = await app.inject({
      method: 'PATCH',
      url: `/api/connectors/${connectorId}`,
      cookies: user.cookies,
      payload: { url: 'https://example.com/mcp' },
    });
    expect(url.statusCode).toBe(400);
  });
});
