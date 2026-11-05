import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.ts';
import { activityLogs, auditLogs, users } from '../db/schema.ts';
import { createLoggedInUser, TEST_GROUPS, testConfig } from '../testing/app.ts';
import { testDatabaseUrl, useTestDb } from '../testing/db.ts';
import { createFakeIdp } from '../testing/fake-idp.ts';
import {
  FAKE_UPSTREAM_TOKEN,
  type FakeUpstream,
  startFakeUpstream,
} from '../testing/fake-upstream.ts';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe.skipIf(!testDatabaseUrl)('관리자 API (DB)', () => {
  const db = useTestDb();
  let upstream: FakeUpstream;
  let idp: Awaited<ReturnType<typeof createFakeIdp>>;
  let app: FastifyInstance;

  beforeAll(async () => {
    upstream = await startFakeUpstream({ token: FAKE_UPSTREAM_TOKEN });
    idp = await createFakeIdp({ now: () => new Date() });
    app = await buildApp(testConfig(), db, { fetch: idp.fetch });
  });
  afterAll(async () => {
    await app.close();
    await upstream.close();
  });

  type Method = 'GET' | 'POST' | 'PATCH';
  async function login(role: 'user' | 'admin') {
    const user = await createLoggedInUser(db);
    if (role === 'admin') await db.update(users).set({ role }).where(eq(users.id, user.id));
    const call = (method: Method, url: string, payload?: object) =>
      app.inject({ method, url, payload, cookies: user.cookies });
    return { ...user, call };
  }

  // 정적 토큰 원격 커넥터와 엔드포인트를 가진 사용자
  async function userWithEndpoint() {
    const owner = await login('user');
    const res = await owner.call('POST', '/api/endpoints', {
      name: 'Home CMS',
      allowedTools: ['read_item'],
      connector: {
        name: 'CMS',
        url: `${upstream.url}?api_key=query-secret`,
        auth: { type: 'static_token', token: FAKE_UPSTREAM_TOKEN },
      },
    });
    expect(res.statusCode).toBe(201);
    const endpoint = res.json();
    return { owner, endpoint, connectorId: endpoint.connector.id as string };
  }

  const initialize = {
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 't', version: '1' },
    },
  };
  const toolCall = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'read_item', arguments: { id: '1' } },
  };

  // 사용 중지 여부는 initialize 응답 상태로 본다
  function mcpCall(endpointId: string, sub: string, payload: object = initialize) {
    return idp.signAccessToken({ sub, groups: [TEST_GROUPS.users] }).then((token) =>
      app.inject({
        method: 'POST',
        url: `/c/${endpointId}/mcp`,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        payload,
      }),
    );
  }

  const adminUrls: [Method, string][] = [
    ['GET', '/api/admin/users'],
    ['GET', `/api/admin/users/${UNKNOWN_ID}/connectors`],
    ['GET', `/api/admin/users/${UNKNOWN_ID}/endpoints`],
    ['PATCH', `/api/admin/connectors/${UNKNOWN_ID}`],
    ['GET', '/api/admin/audit'],
    ['GET', '/api/admin/audit/summary'],
  ];

  it('세션이 없으면 401, 일반 사용자는 403이고 role은 매 요청 DB에서 다시 읽는다', async () => {
    for (const [method, url] of adminUrls) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
    }
    const user = await login('user');
    for (const [method, url] of adminUrls) {
      const res = await user.call(method, url, { disabled: false });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('forbidden');
    }
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, user.id));
    expect((await user.call('GET', '/api/admin/users')).statusCode).toBe(200);
    await db.update(users).set({ role: 'user' }).where(eq(users.id, user.id));
    expect((await user.call('GET', '/api/admin/users')).statusCode).toBe(403);
  });

  it('사용자 목록과 사용자별 커넥터를 주되, 어느 관리자에게도 자격증명 값은 주지 않는다', async () => {
    const { owner, connectorId, endpoint } = await userWithEndpoint();
    for (const admin of [await login('admin'), await login('admin')]) {
      const list = await admin.call('GET', `/api/admin/users?q=${encodeURIComponent(owner.sub)}`);
      expect(list.json().users).toEqual([
        expect.objectContaining({
          id: owner.id,
          role: 'user',
          groups: [TEST_GROUPS.users],
          connectorCount: 1,
          disabledConnectorCount: 0,
          endpointCount: 1,
        }),
      ]);
      const connectors = await admin.call('GET', `/api/admin/users/${owner.id}/connectors`);
      expect(connectors.statusCode).toBe(200);
      expect(connectors.json().connectors).toEqual([
        expect.objectContaining({
          id: connectorId,
          name: 'CMS',
          runtime: 'remote',
          url: `${upstream.url}?api_key=***`,
          endpointCount: 1,
          disabled: null,
        }),
      ]);
      expect(connectors.body).not.toContain(FAKE_UPSTREAM_TOKEN);
      expect(connectors.body).not.toContain('query-secret');
      expect(connectors.body).not.toContain('credential');

      const endpoints = await admin.call('GET', `/api/admin/users/${owner.id}/endpoints`);
      expect(endpoints.json().endpoints).toEqual([
        { id: endpoint.id, name: 'Home CMS', connectorId },
      ]);
    }
    const admin = await login('admin');
    expect((await admin.call('GET', `/api/admin/users/${UNKNOWN_ID}/connectors`)).statusCode).toBe(
      404,
    );
    expect((await admin.call('GET', '/api/admin/users/not-a-uuid/connectors')).statusCode).toBe(
      404,
    );
  });

  it('사용 중지는 사유가 필요하고, 바로 MCP 호출을 거부하며, 다시 사용하면 풀린다', async () => {
    const { owner, endpoint, connectorId } = await userWithEndpoint();
    const admin = await login('admin');
    const url = `/api/admin/connectors/${connectorId}`;
    expect((await mcpCall(endpoint.id, owner.sub)).statusCode).toBe(200);

    for (const body of [
      { disabled: true },
      { disabled: true, reason: '  ' },
      { disabled: 'yes' },
    ]) {
      expect((await admin.call('PATCH', url, body)).statusCode).toBe(400);
    }
    const tooLong = await admin.call('PATCH', url, { disabled: true, reason: 'x'.repeat(201) });
    expect(tooLong.statusCode).toBe(400);

    const disabled = await admin.call('PATCH', url, { disabled: true, reason: '외부 유출 의심' });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().disabled).toMatchObject({
      reason: '외부 유출 의심',
      by: { id: admin.id },
    });
    expect((await mcpCall(endpoint.id, owner.sub)).statusCode).toBe(403);

    // 사용자는 목록에서 사용 중지 상태와 사유를 본다. 설정을 바꿔도 다시 켜지지 않는다
    const mine = (await owner.call('GET', '/api/endpoints')).json().endpoints[0];
    expect(mine).toMatchObject({
      status: 'disabled',
      connector: { disabledReason: '외부 유출 의심' },
    });
    await owner.call('PATCH', `/api/connectors/${connectorId}`, { name: 'Renamed' });
    expect((await mcpCall(endpoint.id, owner.sub)).statusCode).toBe(403);

    const enabled = await admin.call('PATCH', url, { disabled: false });
    expect(enabled.json().disabled).toBeNull();
    expect((await mcpCall(endpoint.id, owner.sub)).statusCode).toBe(200);

    const logs = await db
      .select({
        actorId: activityLogs.actorId,
        action: activityLogs.action,
        reason: activityLogs.reason,
      })
      .from(activityLogs)
      .where(eq(activityLogs.targetId, connectorId))
      .orderBy(activityLogs.id);
    expect(logs).toEqual([
      { actorId: admin.id, action: 'connector.disable', reason: '외부 유출 의심' },
      { actorId: admin.id, action: 'connector.enable', reason: null },
    ]);
  });

  it('감사 로그를 사용자·결과로 거르고 요약을 준다. 잘못된 필터는 400', async () => {
    const { owner, endpoint, connectorId } = await userWithEndpoint();
    const admin = await login('admin');
    // 세션 없는 tools/call은 업스트림이 거절해 오류로 남는다
    await mcpCall(endpoint.id, owner.sub, toolCall);
    await admin.call('PATCH', `/api/admin/connectors/${connectorId}`, {
      disabled: true,
      reason: 'test',
    });
    expect((await mcpCall(endpoint.id, owner.sub, toolCall)).statusCode).toBe(403);
    await vi.waitFor(async () =>
      expect(await db.$count(auditLogs, eq(auditLogs.userId, owner.id))).toBe(2),
    );

    const denied = await admin.call('GET', `/api/admin/audit?userId=${owner.id}&result=denied`);
    expect(denied.statusCode).toBe(200);
    expect(denied.json()).toEqual({
      entries: [
        expect.objectContaining({
          user: expect.objectContaining({ id: owner.id }),
          endpoint: { id: endpoint.id, name: 'Home CMS' },
          connector: { id: connectorId, name: 'CMS' },
          toolName: 'read_item',
          result: 'denied',
        }),
      ],
      nextCursor: null,
    });
    const from = new Date(Date.now() - 3600_000).toISOString();
    const summary = await admin.call(
      'GET',
      `/api/admin/audit/summary?userId=${owner.id}&from=${encodeURIComponent(from)}`,
    );
    expect(summary.json()).toMatchObject({ total: 2, errors: 1, denied: 1, retentionDays: 90 });

    for (const query of ['from=yesterday', 'result=blocked', 'userId=abc', 'cursor=@@']) {
      expect((await admin.call('GET', `/api/admin/audit?${query}`)).statusCode).toBe(400);
    }
  });
});
