import { randomUUID } from 'node:crypto';
import type { ConnectorManifest } from '@mcp-outlet/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { createSecretBox } from '../crypto/secrets.ts';
import type { ConnectorRow } from '../db/queries/connectors.ts';
import { connectors, endpoints, users } from '../db/schema.ts';
import type { ConnectorRuntime } from '../runtimes/types.ts';
import { testDatabaseUrl, useTestDb } from '../testing/db.ts';
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

  async function newBuiltinEndpoint() {
    const [user] = await db
      .insert(users)
      .values({ sub: `sub-${randomUUID()}` })
      .returning({ id: users.id });
    if (!user) throw new Error('no user');
    const [connector] = await db
      .insert(connectors)
      .values({ ownerId: user.id, runtime: 'builtin', manifest, status: 'error' })
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
  ) {
    const proxy = createMcpProxy({
      db,
      secrets: createSecretBox({ current: KEY }),
      runtimes: { builtin: runtime },
      publicBaseUrl: 'https://outlet.test',
      upstreamTimeoutMs: 3000,
      log: { warn: () => {} },
    });
    const request: McpHttpRequest = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { json },
      signal: new AbortController().signal,
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
});
