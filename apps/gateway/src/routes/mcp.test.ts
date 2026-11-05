import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LoggingMessageNotificationSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.ts';
import { createSecretBox } from '../crypto/secrets.ts';
import { auditLogs, connectors, credentials, endpoints, users } from '../db/schema.ts';
import { createLoggedInUser, TEST_GROUPS, testConfig } from '../testing/app.ts';
import { testDatabaseUrl, useTestDb } from '../testing/db.ts';
import { createFakeIdp } from '../testing/fake-idp.ts';
import {
  FAKE_UPSTREAM_TOKEN,
  type FakeUpstream,
  startFakeUpstream,
} from '../testing/fake-upstream.ts';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe.skipIf(!testDatabaseUrl)('MCP 프록시 /c/{id}/mcp (DB)', () => {
  const db = useTestDb();
  const config = testConfig();
  let upstream: FakeUpstream;
  let jsonUpstream: FakeUpstream;
  let idp: Awaited<ReturnType<typeof createFakeIdp>>;
  let app: FastifyInstance;
  let base = '';

  beforeAll(async () => {
    upstream = await startFakeUpstream({ token: FAKE_UPSTREAM_TOKEN });
    jsonUpstream = await startFakeUpstream({ jsonResponse: true });
    idp = await createFakeIdp({ now: () => new Date() });
    app = await buildApp(config, db, { fetch: idp.fetch });
    await app.listen({ host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
    await upstream.close();
    await jsonUpstream.close();
  });

  async function newEndpoint(options: { upstream?: FakeUpstream; token?: boolean } = {}) {
    const target = options.upstream ?? upstream;
    const user = await createLoggedInUser(db);
    const res = await app.inject({
      method: 'POST',
      url: '/api/endpoints',
      cookies: user.cookies,
      payload: {
        name: 'proxy',
        allowedTools: ['read_item', 'slow_count'],
        connector: {
          name: 'Fake',
          url: target.url,
          auth:
            options.token === false
              ? { type: 'none' }
              : { type: 'static_token', token: FAKE_UPSTREAM_TOKEN },
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const endpoint = res.json();
    const token = await idp.signAccessToken({
      sub: user.sub,
      email: 'mcp@test',
      groups: [TEST_GROUPS.users],
    });
    return { user, endpoint, token, url: `${base}/c/${endpoint.id}/mcp` };
  }

  async function connect(url: string, token: string) {
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(transport);
    return { client, transport };
  }

  const initialize = {
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'raw', version: '1' },
    },
  };

  function post(url: string, token: string | null, body: unknown, headers: object = {}) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  async function auditRows(endpointId: string) {
    return db
      .select({ toolName: auditLogs.toolName, result: auditLogs.result })
      .from(auditLogs)
      .where(eq(auditLogs.endpointId, endpointId))
      .orderBy(auditLogs.id);
  }

  it('토큰이 없거나 틀리면 엔드포인트 존재와 상관없이 401과 resource_metadata를 준다', async () => {
    const { url, endpoint } = await newEndpoint();
    for (const [target, id] of [
      [url, endpoint.id],
      [`${base}/c/${UNKNOWN_ID}/mcp`, UNKNOWN_ID],
    ]) {
      const res = await post(target, null, initialize);
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe(
        `Bearer resource_metadata="https://outlet.test/.well-known/oauth-protected-resource/c/${id}/mcp"`,
      );
    }
    const bad = await post(url, 'not-a-jwt', initialize);
    expect(bad.status).toBe(401);
    expect(bad.headers.get('www-authenticate')).toContain('error="invalid_token"');

    const wrongAud = await idp.signAccessToken(
      { sub: 'x', groups: [TEST_GROUPS.users] },
      { aud: 'other' },
    );
    expect((await post(url, wrongAud, initialize)).status).toBe(401);
  });

  it('보호 리소스 메타데이터는 리소스 URL과 IdP issuer를 준다 (없는 엔드포인트도 같은 모양)', async () => {
    const res = await fetch(`${base}/.well-known/oauth-protected-resource/c/${UNKNOWN_ID}/mcp`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toEqual({
      resource: `https://outlet.test/c/${UNKNOWN_ID}/mcp`,
      authorization_servers: ['https://idp.test/app'],
      // OIDC_SCOPES 기본값 + offline_access
      scopes_supported: ['openid', 'email', 'profile', 'offline_access'],
      bearer_methods_supported: ['header'],
      resource_name: 'MCP Outlet',
    });
  });

  it('다른 사용자의 토큰과 없는 엔드포인트는 같은 404', async () => {
    const { url } = await newEndpoint();
    const other = await newEndpoint();
    const res = await post(url, other.token, initialize);
    expect(res.status).toBe(404);
    expect((await post(`${base}/c/${UNKNOWN_ID}/mcp`, other.token, initialize)).status).toBe(404);
    expect((await post(`${base}/c/abc/mcp`, other.token, initialize)).status).toBe(404);
  });

  it('로그인 허용 그룹에서 빠지면 403이고 groups를 갱신하며 관리자 role과 관리 UI 세션을 거둔다', async () => {
    const { url, user } = await newEndpoint();
    await db.update(users).set({ role: 'admin' }).where(eq(users.sub, user.sub));
    const token = await idp.signAccessToken({
      sub: user.sub,
      email: 'new@test',
      groups: ['Other'],
    });
    const res = await post(url, token, initialize);
    expect(res.status).toBe(403);
    const [row] = await db.select().from(users).where(eq(users.sub, user.sub));
    expect(row).toMatchObject({ groups: ['Other'], role: 'user' });
    const me = await app.inject({ url: '/api/admin/users', cookies: user.cookies });
    expect(me.statusCode).toBe(401);
  });

  it('groups 클레임이 없는 토큰은 저장된 groups로 판정하고 groups·role·세션을 그대로 둔다', async () => {
    const { url, user } = await newEndpoint();
    await db
      .update(users)
      .set({ groups: [TEST_GROUPS.admins], role: 'admin' })
      .where(eq(users.sub, user.sub));
    const token = await idp.signAccessToken({ sub: user.sub, email: 'mcp@test' });
    expect((await post(url, token, initialize)).status).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.sub, user.sub));
    expect(row).toMatchObject({ groups: [TEST_GROUPS.admins], role: 'admin' });
    const admin = await app.inject({ url: '/api/admin/users', cookies: user.cookies });
    expect(admin.statusCode).toBe(200);
  });

  it('groups 클레임이 없고 관리 UI에 로그인한 적 없는 사용자는 그룹 밖으로 본다', async () => {
    const token = await idp.signAccessToken({ sub: `never-${UNKNOWN_ID}` });
    expect((await post(`${base}/c/${UNKNOWN_ID}/mcp`, token, initialize)).status).toBe(403);
  });

  it('groups 클레임이 빈 배열이면 그룹 밖이고 role과 세션을 거둔다', async () => {
    const { url, user } = await newEndpoint();
    await db.update(users).set({ role: 'admin' }).where(eq(users.sub, user.sub));
    const token = await idp.signAccessToken({ sub: user.sub, groups: [] });
    expect((await post(url, token, initialize)).status).toBe(403);
    const [row] = await db.select().from(users).where(eq(users.sub, user.sub));
    expect(row).toMatchObject({ groups: [], role: 'user' });
    const me = await app.inject({ url: '/api/admin/users', cookies: user.cookies });
    expect(me.statusCode).toBe(401);
  });

  it('엔드포인트 비활성·커넥터 사용 중지는 다음 요청부터 거부한다', async () => {
    const { url, token, endpoint } = await newEndpoint();
    expect((await post(url, token, initialize)).status).toBe(200);
    await db.update(endpoints).set({ enabled: false }).where(eq(endpoints.id, endpoint.id));
    expect((await post(url, token, initialize)).status).toBe(403);
    await db.update(endpoints).set({ enabled: true }).where(eq(endpoints.id, endpoint.id));
    await db
      .update(connectors)
      .set({ disabledAt: new Date(), disabledReason: 'test' })
      .where(eq(connectors.id, endpoint.connector.id));
    expect((await post(url, token, initialize)).status).toBe(403);
  });

  it('엔드포인트를 지우면 다음 요청부터 404', async () => {
    const { url, token, endpoint } = await newEndpoint();
    expect((await post(url, token, initialize)).status).toBe(200);
    await db.delete(endpoints).where(eq(endpoints.id, endpoint.id));
    expect((await post(url, token, initialize)).status).toBe(404);
  });

  it('사용 중지된 커넥터로 온 툴 호출은 403으로 막고 감사 로그에 거부로 남긴다', async () => {
    const { url, token, endpoint } = await newEndpoint();
    await db
      .update(connectors)
      .set({ disabledAt: new Date(), disabledReason: 'abuse' })
      .where(eq(connectors.id, endpoint.connector.id));
    const res = await post(url, token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'read_item', arguments: { id: '1' } },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('사용 중지');
    await vi.waitFor(async () =>
      expect(await auditRows(endpoint.id)).toEqual([{ toolName: 'read_item', result: 'denied' }]),
    );
  });

  it('허용한 툴만 보이고, 목록 밖 호출은 MCP 오류로 거부하며 감사 로그를 남긴다', async () => {
    const { url, token, endpoint } = await newEndpoint();
    const { client, transport } = await connect(url, token);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(['read_item', 'slow_count']);

      const read = await client.callTool({ name: 'read_item', arguments: { id: '42' } });
      expect(read.content).toEqual([{ type: 'text', text: 'item 42' }]);

      const denied = await client
        .callTool({ name: 'delete_item', arguments: { id: '42' } })
        .catch((error: unknown) => error);
      expect(denied).toBeInstanceOf(McpError);
      expect((denied as McpError).code).toBe(-32602);

      // 클라이언트 세션 ID는 업스트림이 만든 것을 그대로 전달한다
      expect(upstream.sessions.has(transport.sessionId ?? '')).toBe(true);
      // 업스트림에는 게이트웨이 JWT가 아니라 커넥터 자격증명이 간다
      const lastHeaders = upstream.received.at(-1);
      expect(lastHeaders?.authorization).toBe(`Bearer ${FAKE_UPSTREAM_TOKEN}`);
    } finally {
      await transport.terminateSession();
      await client.close();
    }
    await vi.waitFor(async () => {
      expect(await auditRows(endpoint.id)).toEqual([
        { toolName: 'read_item', result: 'ok' },
        { toolName: 'delete_item', result: 'denied' },
      ]);
    });
    const [row] = await db.select().from(endpoints).where(eq(endpoints.id, endpoint.id));
    expect(row?.lastCalledAt).toBeInstanceOf(Date);
  });

  it('SSE 응답을 이벤트 단위로 바로 전달한다', async () => {
    const { url, token, endpoint } = await newEndpoint();
    const { client, transport } = await connect(url, token);
    const received: number[] = [];
    client.setNotificationHandler(LoggingMessageNotificationSchema, () => {
      received.push(Date.now());
    });
    try {
      const startedAt = Date.now();
      const result = await client.callTool({ name: 'slow_count', arguments: { to: 5 } });
      expect(result.content).toEqual([{ type: 'text', text: 'counted to 5' }]);
      expect(received).toHaveLength(5);
      // 첫 알림은 결과(약 100ms 뒤)보다 먼저 와야 한다. 모았다가 보내면 같은 시각에 몰린다
      expect((received[0] ?? Infinity) - startedAt).toBeLessThan(
        (received.at(-1) ?? 0) - startedAt,
      );
    } finally {
      await client.close();
    }
    await vi.waitFor(async () => {
      expect(await auditRows(endpoint.id)).toEqual([{ toolName: 'slow_count', result: 'ok' }]);
    });
    expect(transport.sessionId).toBeTruthy();
  });

  it('JSON 응답 모드 업스트림도 tools/list를 거른다', async () => {
    const { url, token } = await newEndpoint({ upstream: jsonUpstream, token: false });
    const { client } = await connect(url, token);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(['read_item', 'slow_count']);
    } finally {
      await client.close();
    }
  });

  it('resources/list·prompts/get은 업스트림에 보내지 않고 거부한다', async () => {
    const { url, token, endpoint } = await newEndpoint();
    const { client, transport } = await connect(url, token);
    try {
      const resources = await client.listResources().catch((error: unknown) => error);
      expect(resources).toBeInstanceOf(McpError);
      expect((resources as McpError).code).toBe(-32601);
      const prompt = await client.getPrompt({ name: 'summarize' }).catch((error: unknown) => error);
      expect(prompt).toBeInstanceOf(McpError);
      expect((prompt as McpError).code).toBe(-32601);
    } finally {
      await transport.terminateSession();
      await client.close();
    }
    const forwarded = upstream.bodies.join('\n');
    expect(forwarded).not.toContain('resources/list');
    expect(forwarded).not.toContain('prompts/get');
    // 툴 호출이 아니라 감사 로그에 남기지 않는다
    expect(await auditRows(endpoint.id)).toEqual([]);
  });

  it('initialize capabilities에서 resources·prompts를 뺀다', async () => {
    for (const target of [upstream, jsonUpstream]) {
      const { url, token } = await newEndpoint({ upstream: target, token: target === upstream });
      const { client } = await connect(url, token);
      try {
        const capabilities = client.getServerCapabilities();
        expect(capabilities?.tools).toBeDefined();
        expect(capabilities?.logging).toBeDefined();
        expect(capabilities?.resources).toBeUndefined();
        expect(capabilities?.prompts).toBeUndefined();
      } finally {
        await client.close();
      }
    }
  });

  it('배치에 목록 밖 호출이 섞이면 배치 전체를 거부한다', async () => {
    const { url, token, endpoint } = await newEndpoint();
    const res = await post(url, token, [
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_item', arguments: {} } },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'delete_item', arguments: {} },
      },
    ]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number; error: { code: number } }[];
    expect(body.map((item) => [item.id, item.error.code])).toEqual([
      [1, -32600],
      [2, -32602],
    ]);
    await vi.waitFor(async () => {
      expect(await auditRows(endpoint.id)).toEqual([{ toolName: 'delete_item', result: 'denied' }]);
    });
  });

  it('허용목록을 판정한 파싱 결과를 업스트림에 보내 중복 키로 다른 툴을 부를 수 없다', async () => {
    const { url, token } = await newEndpoint();
    // JSON.parse는 뒤의 name(read_item)을 쓴다. 원문을 그대로 보내면 앞의 값을 쓰는 업스트림은 delete_item을 부른다
    const raw =
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"delete_item","name":"read_item","arguments":{"id":"1"}}}';
    await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: raw,
    });
    expect(JSON.parse(upstream.bodies.at(-1) ?? 'null')).toEqual(JSON.parse(raw));
    expect(upstream.bodies.at(-1)).not.toContain('delete_item');
  });

  it('깨진 JSON은 parse error', async () => {
    const { url, token } = await newEndpoint();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32700);
  });

  it('tools/call의 업스트림 인증 실패는 isError 툴 결과에 관리 화면 링크를 담고 커넥터를 오류 상태로 둔다', async () => {
    const { url, token, endpoint, user } = await newEndpoint();
    const { client } = await connect(url, token);
    // 업스트림 토큰이 바뀐 상황
    const secrets = createSecretBox({ current: config.ENCRYPTION_KEY });
    await db
      .update(credentials)
      .set({ ciphertext: secrets.encrypt(JSON.stringify({ TOKEN: 'revoked' })) })
      .where(
        and(eq(credentials.connectorId, endpoint.connector.id), eq(credentials.userId, user.id)),
      );
    try {
      const result = await client.callTool({ name: 'read_item', arguments: { id: '1' } });
      expect(result.isError).toBe(true);
      const message = (result.content as { type: string; text: string }[])[0]?.text ?? '';
      expect(message).toContain('인증');
      expect(message).toContain(`https://outlet.test/admin/endpoints/${endpoint.id}`);
      expect(message).not.toContain('upstream says');
    } finally {
      await client.close();
    }
    await vi.waitFor(async () => {
      const [row] = await db
        .select()
        .from(connectors)
        .where(eq(connectors.id, endpoint.connector.id));
      expect(row?.status).toBe('error');
      expect(await auditRows(endpoint.id)).toEqual([{ toolName: 'read_item', result: 'error' }]);
    });
  });

  it('initialize 실패는 JSON-RPC 오류로 두고, 배치에서는 tools/call만 툴 결과로 준다', async () => {
    const { url, token, endpoint, user } = await newEndpoint();
    const secrets = createSecretBox({ current: config.ENCRYPTION_KEY });
    await db
      .update(credentials)
      .set({ ciphertext: secrets.encrypt(JSON.stringify({ TOKEN: 'revoked' })) })
      .where(
        and(eq(credentials.connectorId, endpoint.connector.id), eq(credentials.userId, user.id)),
      );
    const link = `https://outlet.test/admin/endpoints/${endpoint.id}`;

    const init = await post(url, token, initialize);
    expect(init.status).toBe(200);
    const initBody = (await init.json()) as { result?: unknown; error?: { message: string } };
    expect(initBody.result).toBeUndefined();
    expect(initBody.error?.message).toContain(link);

    const batch = await post(url, token, [
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_item', arguments: {} } },
    ]);
    const items = (await batch.json()) as {
      id: number;
      result?: { isError: boolean; content: { text: string }[] };
      error?: { code: number };
    }[];
    expect(items[0]?.error?.code).toBe(-32000);
    expect(items[1]?.error).toBeUndefined();
    expect(items[1]?.result?.isError).toBe(true);
    expect(items[1]?.result?.content[0]?.text).toContain(link);
  });

  it('클라이언트가 끊으면 업스트림 스트림도 끊는다', async () => {
    const { url, token } = await newEndpoint();
    const init = await post(url, token, initialize);
    const sessionId = init.headers.get('mcp-session-id') ?? '';
    await init.body?.cancel();
    const headers = { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-06-18' };
    await (
      await post(url, token, { jsonrpc: '2.0', method: 'notifications/initialized' }, headers)
    ).body?.cancel();

    const before = upstream.stats.closedEarly;
    const abort = new AbortController();
    const res = await fetch(url, {
      method: 'POST',
      signal: abort.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'slow_count', arguments: { to: 200 } },
      }),
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body?.getReader();
    await reader?.read();
    abort.abort();
    await vi.waitFor(() => expect(upstream.stats.closedEarly).toBeGreaterThan(before));
  });
});
