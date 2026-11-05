import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { TEST_GROUPS, testConfig } from './testing/app.ts';
import { testDatabaseUrl, useTestDb } from './testing/db.ts';
import { createFakeGoogle, FAKE_OAUTH_CLIENT, type FakeGoogle } from './testing/fake-google.ts';
import { createFakeIdp, FAKE_CLIENT_SECRET } from './testing/fake-idp.ts';
import {
  FAKE_UPSTREAM_TOKEN,
  type FakeUpstream,
  startFakeUpstream,
} from './testing/fake-upstream.ts';

// 토큰·client secret·자격증명·URL 쿼리(code, state)가 로그에 남지 않는지 본다.
// 가장 자세한 trace 수준으로 실제 흐름을 돌리고 pino 출력 전체를 검사한다
describe.skipIf(!testDatabaseUrl)('로그 누출 회귀 (DB)', () => {
  const db = useTestDb();
  const lines: string[] = [];
  // 로그에 나오면 안 되는 값. 흐름마다 받은 값을 더한다
  const secrets = new Set<string>([FAKE_CLIENT_SECRET, FAKE_UPSTREAM_TOKEN]);
  let idp: Awaited<ReturnType<typeof createFakeIdp>>;
  let google: FakeGoogle;
  let upstream: FakeUpstream;
  let app: FastifyInstance;
  let base = '';
  let session = '';
  let sub = '';

  beforeAll(async () => {
    const now = () => new Date();
    idp = await createFakeIdp({ now });
    google = await createFakeGoogle({ now });
    upstream = await startFakeUpstream({ token: FAKE_UPSTREAM_TOKEN });
    app = await buildApp(testConfig({ LOG_LEVEL: 'trace' }), db, {
      fetch: idp.fetch,
      apiFetch: google.fetch,
      now,
      logStream: { write: (line) => lines.push(line) },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
    await upstream.close();
  });

  const cookieOf = (res: { cookies: { name: string; value: string }[] }, name: string) =>
    res.cookies.find((c) => c.name === name)?.value ?? '';

  function expectNoLeak(flow: string) {
    const output = lines.join('');
    // 수집이 실제로 되는지 확인한다
    expect(output, flow).toContain('"msg":"incoming request"');
    for (const secret of secrets) {
      expect(output.includes(secret), `${flow}: ${secret.slice(0, 6)}…`).toBe(false);
    }
    // 요청 줄의 URL에는 경로만 남는다
    for (const line of lines) {
      const url = (JSON.parse(line) as { req?: { url?: string } }).req?.url;
      if (url) expect(url, flow).not.toContain('?');
    }
    // Google 토큰 형식(access ya29.…, refresh 1//…)
    expect(output, flow).not.toMatch(/ya29\.|"1\/\//);
  }

  it('로그인 콜백', async () => {
    const start = await app.inject('/auth/login?returnTo=%2Fadmin%2F');
    const location = new URL(start.headers.location ?? '');
    const state = location.searchParams.get('state') ?? '';
    sub = `sub-log-${Date.now()}`;
    const code = idp.authorize(location.toString(), {
      sub,
      email: 'log@test',
      groups: [TEST_GROUPS.users],
    });
    const loginCookie = cookieOf(start, 'outlet_login');
    const res = await app.inject({
      url: `/auth/callback?code=${code}&state=${state}`,
      cookies: { outlet_login: loginCookie },
    });
    expect(res.headers.location).toBe('/admin/');
    session = cookieOf(res, 'outlet_session');
    for (const value of [code, state, loginCookie, session, cookieOf(res, 'outlet_id_token')]) {
      secrets.add(value);
    }
    // 실패한 콜백도 쿼리를 남기지 않는다
    await app.inject(`/auth/callback?code=leaked-code-1&state=leaked-state-1`);
    secrets.add('leaked-code-1').add('leaked-state-1');
    expectNoLeak('login');
  });

  it('연결 테스트(정적 토큰)와 MCP 호출(Bearer)', async () => {
    const connector = (token: string) => ({
      name: 'Fake',
      url: upstream.url,
      auth: { type: 'static_token', token },
    });
    const call = (url: string, payload: object) =>
      app.inject({ method: 'POST', url, payload, cookies: { outlet_session: session } });

    expect((await call('/api/connectors/test', connector(FAKE_UPSTREAM_TOKEN))).json().result).toBe(
      'ok',
    );
    const wrong = 'wrong-static-token-xyz';
    secrets.add(wrong);
    expect((await call('/api/connectors/test', connector(wrong))).json().result).toBe(
      'auth_failed',
    );
    const created = await call('/api/endpoints', {
      name: 'log',
      allowedTools: ['read_item'],
      connector: connector(FAKE_UPSTREAM_TOKEN),
    });
    expect(created.statusCode).toBe(201);
    const url = `${base}/c/${created.json().id}/mcp`;

    const bearer = await idp.signAccessToken({ sub, groups: [TEST_GROUPS.users] });
    secrets.add(bearer);
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${bearer}` } },
    });
    const client = new Client({ name: 'log-test', version: '1.0.0' });
    await client.connect(transport);
    await client.listTools();
    const result = await client.callTool({ name: 'read_item', arguments: { id: 'secret-arg' } });
    expect(result.isError).toBeFalsy();
    await client.close();

    // 거부되는 Bearer도 남기지 않는다
    const forged = `${bearer.slice(0, -4)}AAAA`;
    secrets.add(forged);
    const denied = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${forged}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(denied.status).toBe(401);
    expectNoLeak('mcp');
  });

  it('업스트림 OAuth 동의 콜백', async () => {
    secrets.add(FAKE_OAUTH_CLIENT.clientSecret);
    const cookies = { outlet_session: session };
    const pending = await app.inject({
      method: 'POST',
      url: '/api/connectors',
      cookies,
      payload: {
        builtin: 'google-analytics',
        name: 'GA',
        auth: { type: 'oauth2', ...FAKE_OAUTH_CLIENT },
      },
    });
    expect(pending.statusCode).toBe(201);
    const start = await app.inject({
      method: 'POST',
      url: `/api/connectors/${pending.json().id}/oauth/start`,
      cookies,
      payload: { returnTo: '/admin/' },
    });
    const authorizationUrl = start.json().authorizationUrl as string;
    const state = new URL(authorizationUrl).searchParams.get('state') ?? '';
    const upstreamCookie = cookieOf(start, 'outlet_upstream');
    const code = google.consent(authorizationUrl);
    secrets.add(state).add(code).add(upstreamCookie);

    const done = await app.inject({
      url: `/auth/upstream/callback?code=${code}&state=${state}`,
      cookies: { ...cookies, outlet_upstream: upstreamCookie },
    });
    expect(done.headers.location).toBe('/admin/?connected=1');
    // 실패 경로(state 불일치·업스트림 오류)도 확인한다
    await app.inject({
      url: '/auth/upstream/callback?code=leaked-code-2&state=leaked-state-2',
      cookies: { outlet_upstream: upstreamCookie },
    });
    await app.inject('/auth/upstream/callback?error=server_error&error_description=leaked-desc');
    secrets.add('leaked-code-2').add('leaked-state-2').add('leaked-desc');
    expectNoLeak('upstream oauth');
  });
});
