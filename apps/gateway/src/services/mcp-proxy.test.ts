import { randomUUID } from 'node:crypto';
import type { ConnectorManifest } from '@mcp-outlet/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { createSecretBox } from '../crypto/secrets.ts';
import type { ConnectorRow } from '../db/queries/connectors.ts';
import { auditLogs, connectors, endpoints, users } from '../db/schema.ts';
import { MAX_TOOL_NAME_LENGTH } from '../mcp/limits.ts';
import { MAX_DENIED_AUDIT_ROWS } from '../mcp/tool-policy.ts';
import type { ConnectorRuntime } from '../runtimes/types.ts';
import { testDatabaseUrl, useTestDb } from '../testing/db.ts';
import { UpstreamError } from '../upstream/safe-fetch.ts';
import { createMcpProxy, type McpHttpRequest } from './mcp-proxy.ts';

const KEY = Buffer.alloc(32, 7).toString('base64');

const manifest: ConnectorManifest = {
  manifestVersion: 1,
  name: 'GA',
  runtime: 'builtin',
  builtin: 'google-analytics',
  visibleGroups: [],
  credentials: [],
  auth: { type: 'none' },
};

describe.skipIf(!testDatabaseUrl)('MCP 중계의 커넥터 상태 (DB)', () => {
  const db = useTestDb();

  // 툴 결과를 그대로 돌려주는 builtin 런타임
  function runtimeReturning(result: Record<string, unknown>): ConnectorRuntime {
    return {
      testConnection: async () => ({ result: 'ok', tools: [] }),
      forward: async () => Response.json({ jsonrpc: '2.0', id: 1, result }),
    };
  }

  async function newBuiltinEndpoint(status: 'ok' | 'error' = 'error') {
    const [user] = await db
      .insert(users)
      .values({ sub: `sub-${randomUUID()}` })
      .returning({ id: users.id });
    if (!user) throw new Error('no user');
    const [connector] = await db
      .insert(connectors)
      .values({ ownerId: user.id, runtime: 'builtin', manifest, status })
      .returning();
    if (!connector) throw new Error('no connector');
    const [endpoint] = await db
      .insert(endpoints)
      .values({
        ownerId: user.id,
        connectorId: connector.id,
        name: 'GA',
        allowedTools: ['run_report'],
      })
      .returning();
    if (!endpoint) throw new Error('no endpoint');
    return { endpoint, connector };
  }

  async function call(
    runtime: ConnectorRuntime,
    access: Awaited<ReturnType<typeof newBuiltinEndpoint>>,
    json: unknown,
    signal = new AbortController().signal,
    upstreamTimeoutMs = 3000,
  ) {
    const proxy = createMcpProxy({
      db,
      secrets: createSecretBox({ current: KEY }),
      runtimes: { builtin: runtime },
      publicBaseUrl: 'https://outlet.test',
      upstreamTimeoutMs,
      log: { warn: () => {} },
    });
    const request: McpHttpRequest = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { json },
      signal,
    };
    return proxy.proxy(access, request);
  }

  const toolCall = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'run_report', arguments: {} },
  };

  async function statusOf(connector: ConnectorRow) {
    const [row] = await db.select().from(connectors).where(eq(connectors.id, connector.id));
    return row?.status;
  }

  it('툴 결과가 isError면 HTTP 200이어도 오류 상태를 정상으로 되돌리지 않는다', async () => {
    const access = await newBuiltinEndpoint();
    const timedOut = runtimeReturning({
      isError: true,
      content: [{ type: 'text', text: '시간 초과' }],
    });
    expect((await call(timedOut, access, toolCall)).status).toBe(200);
    // tools/list는 외부 API에 닿지 않으므로 상태를 바꾸지 않는다
    expect(
      (await call(timedOut, access, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status,
    ).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await statusOf(access.connector)).toBe('error');
  });

  it('성공한 툴 결과가 오면 정상으로 되돌린다', async () => {
    const access = await newBuiltinEndpoint();
    const succeeded = runtimeReturning({ content: [{ type: 'text', text: '{}' }] });
    expect((await call(succeeded, access, toolCall)).status).toBe(200);
    await vi.waitFor(async () => expect(await statusOf(access.connector)).toBe('ok'));
  });

  function runtimeFailing(forward: ConnectorRuntime['forward']): ConnectorRuntime {
    return { testConnection: async () => ({ result: 'ok', tools: [] }), forward };
  }

  it('MCP 호출 중 timeout·업스트림 5xx는 커넥터 상태를 바꾸지 않는다', async () => {
    const access = await newBuiltinEndpoint('ok');
    const timedOut = runtimeFailing(async () => {
      throw new UpstreamError('timeout');
    });
    const serverError = runtimeFailing(async () => new Response('boom', { status: 503 }));
    for (const runtime of [timedOut, serverError]) {
      const res = await call(runtime, access, toolCall);
      expect(JSON.parse(res.body as string).result.isError).toBe(true);
    }
    await vi.waitFor(async () => expect(await auditRows(access.endpoint.id)).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await statusOf(access.connector)).toBe('ok');
  });

  it('JSON 본문을 받다 시간이 지나도 커넥터 상태를 바꾸지 않는다', async () => {
    const access = await newBuiltinEndpoint('ok');
    // 첫 조각만 보내고 끝내지 않는 본문
    const stalled = runtimeFailing(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"jsonrpc":'));
        },
      });
      return new Response(body, { headers: { 'content-type': 'application/json' } });
    });
    const res = await call(stalled, access, toolCall, undefined, 50);
    expect(JSON.parse(res.body as string).result.content[0].text).toContain('너무 늦습니다');
    await vi.waitFor(async () => expect(await auditRows(access.endpoint.id)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await statusOf(access.connector)).toBe('ok');
  });

  it('MCP 호출 중 연결 실패는 커넥터를 오류로 바꾼다', async () => {
    const access = await newBuiltinEndpoint('ok');
    const unreachable = runtimeFailing(async () => {
      throw new UpstreamError('unreachable');
    });
    await call(unreachable, access, toolCall);
    await vi.waitFor(async () => expect(await statusOf(access.connector)).toBe('error'));
  });

  async function auditRows(endpointId: string) {
    return db
      .select({ toolName: auditLogs.toolName, result: auditLogs.result })
      .from(auditLogs)
      .where(eq(auditLogs.endpointId, endpointId))
      .orderBy(auditLogs.id);
  }

  // JSON 본문 첫 조각을 보낸 뒤 연결이 끊기는 런타임
  function runtimeCutMidBody(): ConnectorRuntime {
    return {
      testConnection: async () => ({ result: 'ok', tools: [] }),
      forward: async () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"res'));
          },
          pull(controller) {
            controller.error(new Error('other side closed: upstream-secret'));
          },
        });
        return new Response(body, { headers: { 'content-type': 'application/json' } });
      },
    };
  }

  it('JSON 본문 중간에 업스트림이 끊기면 MCP 오류로 답하고 감사 로그에 error로 남긴다', async () => {
    const access = await newBuiltinEndpoint('ok');
    const res = await call(runtimeCutMidBody(), access, toolCall);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body).toMatchObject({ jsonrpc: '2.0', id: 1, result: { isError: true } });
    expect(body.result.content[0].text).toContain('연결하지 못했습니다');
    expect(res.body).not.toContain('upstream-secret');
    await vi.waitFor(async () =>
      expect(await auditRows(access.endpoint.id)).toEqual([
        { toolName: 'run_report', result: 'error' },
      ]),
    );
    await vi.waitFor(async () => expect(await statusOf(access.connector)).toBe('error'));
  });

  it('클라이언트가 끊어 JSON 본문을 못 읽으면 응답 없이 끝내고 감사 로그에 error로 남긴다', async () => {
    const access = await newBuiltinEndpoint('ok');
    const abort = new AbortController();
    abort.abort();
    const res = await call(runtimeCutMidBody(), access, toolCall, abort.signal);
    expect(res).toEqual({ status: 499, headers: {}, body: null });
    await vi.waitFor(async () =>
      expect(await auditRows(access.endpoint.id)).toEqual([
        { toolName: 'run_report', result: 'error' },
      ]),
    );
    // 클라이언트 탓이라 커넥터 상태는 바꾸지 않는다
    expect(await statusOf(access.connector)).toBe('ok');
  });

  it('목록 밖 호출의 툴 이름은 상한 길이로 자르고, 배치 하나의 거부 행 수를 제한한다', async () => {
    const access = await newBuiltinEndpoint();
    const longName = 'x'.repeat(5000);
    const batch = Array.from({ length: MAX_DENIED_AUDIT_ROWS + 30 }, (_, i) => ({
      ...toolCall,
      id: i + 1,
      params: { name: i === 0 ? longName : `nope_${i}`, arguments: {} },
    }));
    const res = await call(runtimeReturning({}), access, batch);
    expect(res.status).toBe(200);
    await vi.waitFor(async () =>
      expect(await auditRows(access.endpoint.id)).toHaveLength(MAX_DENIED_AUDIT_ROWS),
    );
    // 상한을 넘는 행이 뒤늦게 들어오지 않는지 조금 더 기다린다
    await new Promise((resolve) => setTimeout(resolve, 100));
    const rows = await auditRows(access.endpoint.id);
    expect(rows).toHaveLength(MAX_DENIED_AUDIT_ROWS);
    expect(rows.every((row) => row.result === 'denied')).toBe(true);
    expect(rows.map((row) => row.toolName)).toContain('x'.repeat(MAX_TOOL_NAME_LENGTH));
  });

  it('사용 중지 커넥터로 온 호출도 같은 상한으로 남긴다', async () => {
    const access = await newBuiltinEndpoint();
    const proxy = createMcpProxy({
      db,
      secrets: createSecretBox({ current: KEY }),
      runtimes: {},
      publicBaseUrl: 'https://outlet.test',
      upstreamTimeoutMs: 3000,
      log: { warn: () => {} },
    });
    const batch = Array.from({ length: MAX_DENIED_AUDIT_ROWS + 5 }, (_, i) => ({
      ...toolCall,
      id: i + 1,
      params: { name: 'y'.repeat(300), arguments: {} },
    }));
    proxy.recordDenied(access, { json: batch });
    await vi.waitFor(async () =>
      expect(await auditRows(access.endpoint.id)).toHaveLength(MAX_DENIED_AUDIT_ROWS),
    );
    // 상한을 넘는 행이 뒤늦게 들어오지 않는지 조금 더 기다린다
    await new Promise((resolve) => setTimeout(resolve, 100));
    const rows = await auditRows(access.endpoint.id);
    expect(rows).toHaveLength(MAX_DENIED_AUDIT_ROWS);
    expect(new Set(rows.map((row) => row.toolName))).toEqual(
      new Set(['y'.repeat(MAX_TOOL_NAME_LENGTH)]),
    );
  });
});
