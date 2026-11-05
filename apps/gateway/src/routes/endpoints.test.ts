import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { setConnectorDisabled } from '../db/queries/connectors.ts';
import { createLoggedInUser, testConfig } from '../testing/app.ts';
import { testDatabaseUrl, useTestDb } from '../testing/db.ts';
import { FAKE_CLIENT_ID } from '../testing/fake-idp.ts';
import {
  FAKE_UPSTREAM_TOKEN,
  type FakeUpstream,
  startFakeUpstream,
} from '../testing/fake-upstream.ts';

describe.skipIf(!testDatabaseUrl)('커넥터·엔드포인트 API (DB)', () => {
  const db = useTestDb();
  let upstream: FakeUpstream;

  beforeAll(async () => {
    upstream = await startFakeUpstream({ token: FAKE_UPSTREAM_TOKEN });
  });
  afterAll(() => upstream.close());

  const connector = (token = FAKE_UPSTREAM_TOKEN) => ({
    name: 'Fake MCP',
    url: upstream.url,
    auth: { type: 'static_token', token },
  });

  async function setup(overrides: Record<string, string> = {}) {
    const app = await buildApp(testConfig(overrides), db);
    const user = await createLoggedInUser(db);
    const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
      app.inject({ method, url, payload, cookies: user.cookies });
    return { app, user, call };
  }

  it('세션이 없으면 401', async () => {
    const { app } = await setup();
    for (const url of ['/api/endpoints', '/api/connectors']) {
      expect((await app.inject(url)).statusCode).toBe(401);
    }
    const test = await app.inject({ method: 'POST', url: '/api/connectors/test', payload: {} });
    expect(test.statusCode).toBe(401);
  });

  it('연결 테스트는 분류와 툴 목록만 주고, 실패 원문은 담지 않는다', async () => {
    const { call } = await setup();
    const ok = await call('POST', '/api/connectors/test', connector());
    expect(ok.statusCode).toBe(200);
    expect(ok.json().result).toBe('ok');
    expect(ok.json().tools).toHaveLength(3);

    const denied = await call('POST', '/api/connectors/test', connector('wrong'));
    expect(denied.json()).toEqual({ result: 'auth_failed' });
    expect(denied.body).not.toContain('upstream says');
  });

  it('입력 규칙: http는 허용 대역 설정이 있을 때만, 예약 헤더 거부, 헤더 이름 기본값', async () => {
    const strict = await setup({ UPSTREAM_ALLOW_CIDRS: '' });
    const http = await strict.call('POST', '/api/connectors/test', connector());
    expect(http.statusCode).toBe(400);
    expect(http.json().error.code).toBe('invalid_request');

    const { call } = await setup();
    const reserved = await call('POST', '/api/connectors/test', {
      ...connector(),
      auth: { type: 'static_token', token: 't', header: 'Mcp-Session-Id' },
    });
    expect(reserved.statusCode).toBe(400);
    const blankHeader = await call('POST', '/api/connectors/test', {
      ...connector(),
      auth: { type: 'static_token', token: FAKE_UPSTREAM_TOKEN, header: '', prefix: 'Bearer ' },
    });
    expect(blankHeader.json().result).toBe('ok');
  });

  it('엔드포인트 만들기 → 목록·상세·연결 안내 → 수정 → 삭제', async () => {
    const { call } = await setup();
    const created = await call('POST', '/api/endpoints', {
      name: '  Fake 읽기  ',
      allowedTools: ['read_item'],
      connector: connector(),
    });
    expect(created.statusCode).toBe(201);
    const endpoint = created.json();
    expect(endpoint).toMatchObject({
      name: 'Fake 읽기',
      url: `https://outlet.test/c/${endpoint.id}/mcp`,
      status: 'active',
      toolCounts: { allowed: 1, total: 3, new: 0 },
    });
    expect(created.body).not.toContain(FAKE_UPSTREAM_TOKEN);

    const list = await call('GET', '/api/endpoints');
    expect(list.json().endpoints.map((item: { id: string }) => item.id)).toEqual([endpoint.id]);

    const connectors = await call('GET', '/api/connectors');
    expect(connectors.json().connectors[0]).toMatchObject({
      name: 'Fake MCP',
      credential: { configured: true },
      endpointCount: 1,
    });
    expect(connectors.body).not.toContain(FAKE_UPSTREAM_TOKEN);

    const info = await call('GET', `/api/endpoints/${endpoint.id}/connect-info`);
    expect(info.json()).toEqual({
      url: endpoint.url,
      clientId: FAKE_CLIENT_ID,
      hasClientSecret: true,
    });

    const patched = await call('PATCH', `/api/endpoints/${endpoint.id}`, {
      allowedTools: ['read_item', 'delete_item'],
      enabled: false,
    });
    expect(patched.json()).toMatchObject({
      status: 'inactive',
      allowedTools: ['read_item', 'delete_item'],
    });

    const empty = await call('PATCH', `/api/endpoints/${endpoint.id}`, { allowedTools: [] });
    expect(empty.statusCode).toBe(400);

    const calls = await call('GET', `/api/endpoints/${endpoint.id}/calls`);
    expect(calls.json()).toEqual({ calls: [] });

    const removed = await call('DELETE', `/api/endpoints/${endpoint.id}?deleteConnector=true`);
    expect(removed.json()).toEqual({ connectorDeleted: true });
    expect((await call('GET', `/api/endpoints/${endpoint.id}`)).statusCode).toBe(404);
  });

  it('연결 테스트 실패는 422와 분류, 툴 목록이 바뀌었으면 409', async () => {
    const { call } = await setup();
    const failed = await call('POST', '/api/endpoints', {
      name: 'x',
      allowedTools: ['read_item'],
      connector: connector('wrong'),
    });
    expect(failed.statusCode).toBe(422);
    expect(failed.json().error).toMatchObject({
      code: 'connection_test_failed',
      details: { result: 'auth_failed' },
    });

    const changed = await call('POST', '/api/endpoints', {
      name: 'x',
      allowedTools: ['no_such_tool'],
      connector: connector(),
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error.code).toBe('tools_changed');
  });

  it('관리자가 사용 중지한 커넥터로는 새 엔드포인트를 만들 수 없다', async () => {
    const { user, call } = await setup();
    const created = await call('POST', '/api/endpoints', {
      name: '첫 엔드포인트',
      allowedTools: ['read_item'],
      connector: connector(),
    });
    const connectorId = created.json().connector.id;
    await setConnectorDisabled(db, connectorId, {
      disabledAt: new Date(),
      disabledBy: user.id,
      disabledReason: '점검',
    });

    const denied = await call('POST', '/api/endpoints', {
      name: '두 번째',
      allowedTools: ['read_item'],
      connectorId,
    });
    expect(denied.statusCode).toBe(409);
    expect(denied.json().error.code).toBe('connector_disabled');
    expect((await call('GET', '/api/endpoints')).json().endpoints).toHaveLength(1);

    await setConnectorDisabled(db, connectorId, null);
    const allowed = await call('POST', '/api/endpoints', {
      name: '두 번째',
      allowedTools: ['read_item'],
      connectorId,
    });
    expect(allowed.statusCode).toBe(201);
  });

  it('다른 사용자의 URL과 잘못된 id는 같은 404', async () => {
    const owner = await setup();
    const created = await owner.call('POST', '/api/endpoints', {
      name: 'mine',
      allowedTools: ['read_item'],
      connector: connector(),
    });
    const { id, connector: ownedConnector } = created.json();
    const other = await setup();
    for (const [method, url] of [
      ['GET', `/api/endpoints/${id}`],
      ['PATCH', `/api/endpoints/${id}`],
      ['DELETE', `/api/endpoints/${id}`],
      ['GET', `/api/endpoints/${id}/calls`],
      ['GET', `/api/endpoints/${id}/connect-info`],
      ['GET', `/api/connectors/${ownedConnector.id}`],
      ['POST', `/api/connectors/${ownedConnector.id}/test`],
      ['DELETE', `/api/connectors/${ownedConnector.id}`],
      ['GET', '/api/endpoints/not-a-uuid'],
    ] as const) {
      const res = await other.call(method, url, method === 'PATCH' ? { name: 'x' } : undefined);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.json().error.code).toBe('not_found');
    }
  });

  it('커넥터 재테스트·토큰 교체·삭제', async () => {
    const { call } = await setup();
    const created = await call('POST', '/api/endpoints', {
      name: 'ep',
      allowedTools: ['read_item'],
      connector: connector(),
    });
    const connectorId = created.json().connector.id;

    const retest = await call('POST', `/api/connectors/${connectorId}/test`);
    expect(retest.json().result).toBe('ok');

    const badToken = await call('PATCH', `/api/connectors/${connectorId}`, {
      auth: { type: 'static_token', token: 'wrong' },
    });
    expect(badToken.statusCode).toBe(422);

    const tools = await call('GET', `/api/connectors/${connectorId}/tools`);
    expect(tools.json().tools.map((tool: { name: string }) => tool.name)).toContain('read_item');

    const removed = await call('DELETE', `/api/connectors/${connectorId}`);
    expect(removed.statusCode).toBe(204);
    expect((await call('GET', `/api/endpoints/${created.json().id}`)).statusCode).toBe(404);
  });
});
