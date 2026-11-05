import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSecretBox } from '../crypto/secrets.ts';
import { auditLogs, connectors, credentials, endpoints, users } from '../db/schema.ts';
import { createRuntimes } from '../runtimes/index.ts';
import type { ConnectionTestResult, ConnectorRuntime } from '../runtimes/types.ts';
import { testDatabaseUrl, useTestDb } from '../testing/db.ts';
import {
  FAKE_UPSTREAM_TOKEN,
  type FakeUpstream,
  startFakeUpstream,
} from '../testing/fake-upstream.ts';
import { createUpstreamFetch } from '../upstream/safe-fetch.ts';
import {
  deleteConnector,
  getConnector,
  type RemoteConnectorInput,
  retestConnector,
  updateConnectorSettings,
} from './connectors.ts';
import { loadCredentials } from './credentials.ts';
import {
  createEndpoint,
  deleteEndpoint,
  type EndpointServiceDeps,
  getEndpoint,
  listEndpointCalls,
  listEndpoints,
  updateEndpoint,
} from './endpoints.ts';
import { ServiceError } from './errors.ts';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe.skipIf(!testDatabaseUrl)('커넥터·엔드포인트 서비스 (DB)', () => {
  const db = useTestDb();
  let upstream: FakeUpstream;

  beforeAll(async () => {
    upstream = await startFakeUpstream({ token: FAKE_UPSTREAM_TOKEN });
  });
  afterAll(() => upstream.close());

  function deps(overrides: Partial<EndpointServiceDeps> = {}): EndpointServiceDeps {
    const fetch = createUpstreamFetch({ allowCidrs: ['127.0.0.1/32'], timeoutMs: 3000 });
    return {
      db,
      secrets: createSecretBox({ current: KEY }),
      runtimes: createRuntimes({ remote: { fetch, timeoutMs: 3000 } }),
      builtins: new Map(),
      maxConnectorsPerUser: 20,
      maxEndpointsPerUser: 50,
      publicBaseUrl: 'https://outlet.test',
      now: () => new Date(),
      ...overrides,
    };
  }

  async function newUser() {
    const [user] = await db
      .insert(users)
      .values({ sub: `sub-${randomUUID()}` })
      .returning({ id: users.id });
    if (!user) throw new Error('no user');
    return user.id;
  }

  const remoteInput = (token = FAKE_UPSTREAM_TOKEN): RemoteConnectorInput => ({
    name: 'Fake',
    url: upstream.url,
    auth: { type: 'static_token', token, header: 'Authorization', prefix: 'Bearer ' },
  });

  async function expectServiceError(promise: Promise<unknown>, code: ServiceError['code']) {
    const error = await promise.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).code).toBe(code);
    return error as ServiceError;
  }

  it('새 커넥터와 첫 엔드포인트를 한 번에 저장하고 토큰은 암호문으로만 남긴다', async () => {
    const owner = await newUser();
    const created = await createEndpoint(deps(), owner, {
      name: 'Read only',
      allowedTools: ['read_item', 'read_item'],
      connector: remoteInput(),
    });
    expect(created).toMatchObject({
      name: 'Read only',
      url: `https://outlet.test/c/${created.id}/mcp`,
      status: 'active',
      allowedTools: ['read_item'],
      toolCounts: { allowed: 1, total: 3, new: 0 },
      missingTools: [],
      connector: {
        name: 'Fake',
        runtime: 'remote',
        url: upstream.url,
        builtin: null,
        disabledReason: null,
      },
    });
    expect(created.tools.find((tool) => tool.name === 'read_item')).toMatchObject({
      allowed: true,
      isNew: false,
      annotations: { readOnlyHint: true },
    });

    const [credential] = await db
      .select()
      .from(credentials)
      .where(eq(credentials.connectorId, created.connector.id));
    expect(credential?.ciphertext).not.toContain(FAKE_UPSTREAM_TOKEN);
    const view = await getConnector(deps(), owner, created.connector.id);
    expect(view).toMatchObject({
      auth: { type: 'static_token', header: 'Authorization', prefix: 'Bearer ' },
      credential: { configured: true },
      status: 'ok',
      lastTestResult: 'ok',
      toolCount: 3,
      endpointCount: 1,
    });
    expect(JSON.stringify(view)).not.toContain(FAKE_UPSTREAM_TOKEN);
  });

  it('연결 테스트에 실패하면 아무것도 저장하지 않는다', async () => {
    const owner = await newUser();
    const error = await expectServiceError(
      createEndpoint(deps(), owner, {
        name: 'x',
        allowedTools: ['read_item'],
        connector: remoteInput('wrong'),
      }),
      'connection_test_failed',
    );
    expect(error.details).toEqual({ result: 'auth_failed' });
    expect(await db.select().from(connectors).where(eq(connectors.ownerId, owner))).toHaveLength(0);
  });

  it('커넥터에 없는 툴을 허용하려 하면 tools_changed', async () => {
    const owner = await newUser();
    await expectServiceError(
      createEndpoint(deps(), owner, {
        name: 'x',
        allowedTools: ['gone'],
        connector: remoteInput(),
      }),
      'tools_changed',
    );
  });

  it('사용자당 커넥터·엔드포인트 상한을 넘기면 limit_exceeded', async () => {
    const owner = await newUser();
    const limited = deps({ maxConnectorsPerUser: 1, maxEndpointsPerUser: 2 });
    const first = await createEndpoint(limited, owner, {
      name: 'a',
      allowedTools: ['read_item'],
      connector: remoteInput(),
    });
    await expectServiceError(
      createEndpoint(limited, owner, {
        name: 'b',
        allowedTools: ['read_item'],
        connector: remoteInput(),
      }),
      'limit_exceeded',
    );
    await createEndpoint(limited, owner, {
      name: 'b',
      allowedTools: ['delete_item'],
      connectorId: first.connector.id,
    });
    await expectServiceError(
      createEndpoint(limited, owner, {
        name: 'c',
        allowedTools: ['read_item'],
        connectorId: first.connector.id,
      }),
      'limit_exceeded',
    );
  });

  it('최근 호출은 최신순 20건만 준다 (F-UI-01)', async () => {
    const owner = await newUser();
    const created = await createEndpoint(deps(), owner, {
      name: 'calls',
      allowedTools: ['read_item'],
      connector: remoteInput(),
    });
    const base = Date.parse('2026-11-05T00:00:00Z');
    await db.insert(auditLogs).values(
      Array.from({ length: 25 }, (_, i) => ({
        at: new Date(base + i * 1000),
        endpointId: created.id,
        toolName: `tool_${i}`,
        result: 'ok' as const,
        durationMs: 1,
      })),
    );
    const calls = await listEndpointCalls(deps(), owner, created.id);
    expect(calls).toHaveLength(20);
    expect(calls[0]?.toolName).toBe('tool_24');
    expect(calls[19]?.toolName).toBe('tool_5');
  });

  it('다른 사용자의 엔드포인트·커넥터는 없는 것으로 다룬다', async () => {
    const owner = await newUser();
    const other = await newUser();
    const created = await createEndpoint(deps(), owner, {
      name: 'mine',
      allowedTools: ['read_item'],
      connector: remoteInput(),
    });
    await expectServiceError(getEndpoint(deps(), other, created.id), 'not_found');
    await expectServiceError(
      updateEndpoint(deps(), other, created.id, { enabled: false }),
      'not_found',
    );
    await expectServiceError(
      deleteEndpoint(deps(), other, created.id, { deleteConnector: true }),
      'not_found',
    );
    await expectServiceError(listEndpointCalls(deps(), other, created.id), 'not_found');
    await expectServiceError(getConnector(deps(), other, created.connector.id), 'not_found');
    await expectServiceError(
      createEndpoint(deps(), other, {
        name: 'steal',
        allowedTools: ['read_item'],
        connectorId: created.connector.id,
      }),
      'not_found',
    );
    expect(await listEndpoints(deps(), other)).toEqual([]);
  });

  it('새 툴·사라진 툴을 구분하고, 허용목록 저장이나 확인함이 knownTools를 갱신한다', async () => {
    const owner = await newUser();
    const created = await createEndpoint(deps(), owner, {
      name: 'ep',
      allowedTools: ['read_item'],
      connector: remoteInput(),
    });
    // 커넥터 툴이 바뀐 상황: read_item이 사라지고 new_tool이 생김
    await db
      .update(connectors)
      .set({ toolsCache: [{ name: 'delete_item' }, { name: 'slow_count' }, { name: 'new_tool' }] })
      .where(eq(connectors.id, created.connector.id));

    const before = await getEndpoint(deps(), owner, created.id);
    expect(before.toolCounts).toEqual({ allowed: 0, total: 3, new: 1 });
    expect(before.missingTools).toEqual(['read_item']);
    expect(before.tools.find((tool) => tool.name === 'new_tool')?.isNew).toBe(true);

    const acknowledged = await updateEndpoint(deps(), owner, created.id, {
      acknowledgeNewTools: true,
    });
    expect(acknowledged.toolCounts.new).toBe(0);
    expect(acknowledged.allowedTools).toEqual(['read_item']);

    const saved = await updateEndpoint(deps(), owner, created.id, {
      allowedTools: ['read_item', 'new_tool'],
    });
    expect(saved.allowedTools).toEqual(['read_item', 'new_tool']);
    await expectServiceError(
      updateEndpoint(deps(), owner, created.id, { allowedTools: ['unknown'] }),
      'tools_changed',
    );
  });

  it('상태는 사용 중지 > 커넥터 오류 > 비활성 > 활성 순으로 하나만 보인다', async () => {
    const owner = await newUser();
    const created = await createEndpoint(deps(), owner, {
      name: 'ep',
      allowedTools: ['read_item'],
      connector: remoteInput(),
    });
    const status = async () => (await getEndpoint(deps(), owner, created.id)).status;
    await updateEndpoint(deps(), owner, created.id, { enabled: false });
    expect(await status()).toBe('inactive');
    await db
      .update(connectors)
      .set({ status: 'error' })
      .where(eq(connectors.id, created.connector.id));
    expect(await status()).toBe('connector_error');
    await db
      .update(connectors)
      .set({ disabledAt: new Date(), disabledReason: 'abuse' })
      .where(eq(connectors.id, created.connector.id));
    expect(await status()).toBe('disabled');
    // 사용자 목록에서 사유를 볼 수 있다 (SCR-ADM-04)
    const [summary] = await listEndpoints(deps(), owner);
    expect(summary?.connector.disabledReason).toBe('abuse');
  });

  it('마지막 엔드포인트를 지울 때만 커넥터도 함께 지운다', async () => {
    const owner = await newUser();
    const first = await createEndpoint(deps(), owner, {
      name: 'a',
      allowedTools: ['read_item'],
      connector: remoteInput(),
    });
    const second = await createEndpoint(deps(), owner, {
      name: 'b',
      allowedTools: ['read_item'],
      connectorId: first.connector.id,
    });
    expect(await deleteEndpoint(deps(), owner, first.id, { deleteConnector: true })).toEqual({
      connectorDeleted: false,
    });
    expect(await deleteEndpoint(deps(), owner, second.id, { deleteConnector: true })).toEqual({
      connectorDeleted: true,
    });
    expect(await db.select().from(connectors).where(eq(connectors.id, first.connector.id))).toEqual(
      [],
    );
  });

  it('커넥터를 지우면 엔드포인트도 함께 지워진다', async () => {
    const owner = await newUser();
    const created = await createEndpoint(deps(), owner, {
      name: 'a',
      allowedTools: ['read_item'],
      connector: remoteInput(),
    });
    await deleteConnector(deps(), owner, created.connector.id);
    expect(await db.select().from(endpoints).where(eq(endpoints.id, created.id))).toEqual([]);
  });

  it('주소·토큰 교체는 연결 테스트를 통과해야 저장하고, 이름만 바꾸면 테스트하지 않는다', async () => {
    const owner = await newUser();
    const created = await createEndpoint(deps(), owner, {
      name: 'a',
      allowedTools: ['read_item'],
      connector: remoteInput(),
    });
    const id = created.connector.id;

    await expectServiceError(
      updateConnectorSettings(deps(), owner, id, {
        auth: { type: 'static_token', token: 'wrong', header: 'Authorization', prefix: 'Bearer ' },
      }),
      'connection_test_failed',
    );
    const unchanged = await loadCredentials(deps(), id, owner);
    expect(unchanged).toEqual({ TOKEN: FAKE_UPSTREAM_TOKEN });

    // 토큰을 비우면 저장된 토큰으로 테스트한다
    const kept = await updateConnectorSettings(deps(), owner, id, {
      url: upstream.url,
      auth: { type: 'static_token', header: 'Authorization', prefix: 'Bearer ' },
    });
    expect(kept.lastTestResult).toBe('ok');

    // 업스트림이 꺼진 상태처럼 주소를 막아도 이름만 바꾸면 테스트하지 않는다
    const blocked = deps({
      runtimes: createRuntimes({
        remote: {
          fetch: createUpstreamFetch({ allowCidrs: [], timeoutMs: 1000 }),
          timeoutMs: 1000,
        },
      }),
    });
    const renamed = await updateConnectorSettings(blocked, owner, id, { name: 'Renamed' });
    expect(renamed.name).toBe('Renamed');
  });

  it('재테스트는 상태와 툴 캐시를 갱신하고, 실패하면 커넥터 오류가 된다', async () => {
    const owner = await newUser();
    const created = await createEndpoint(deps(), owner, {
      name: 'a',
      allowedTools: ['read_item'],
      connector: remoteInput(),
    });
    const blocked = deps({
      runtimes: createRuntimes({
        remote: {
          fetch: createUpstreamFetch({ allowCidrs: [], timeoutMs: 1000 }),
          timeoutMs: 1000,
        },
      }),
    });
    expect(await retestConnector(blocked, owner, created.connector.id)).toEqual({
      result: 'private_address',
    });
    expect((await getEndpoint(deps(), owner, created.id)).status).toBe('connector_error');

    const ok = await retestConnector(deps(), owner, created.connector.id);
    expect(ok.result).toBe('ok');
    expect(await getConnector(deps(), owner, created.connector.id)).toMatchObject({
      status: 'ok',
      lastTestResult: 'ok',
      toolCount: 3,
    });
  });

  // 정해진 결과만 돌려주는 원격 런타임
  function testing(result: Exclude<ConnectionTestResult, 'ok'>, clock: Date) {
    const runtime: ConnectorRuntime = {
      testConnection: async () => ({ result }),
      forward: async () => new Response(null, { status: 500 }),
    };
    return deps({ runtimes: { remote: runtime }, now: () => clock });
  }

  it('재테스트가 timeout이면 상태를 그대로 두고 마지막 결과만 갱신한다', async () => {
    const owner = await newUser();
    const created = await createEndpoint(deps(), owner, {
      name: 'a',
      allowedTools: ['read_item'],
      connector: remoteInput(),
    });
    const id = created.connector.id;
    const first = new Date('2026-11-06T01:00:00Z');
    expect(await retestConnector(testing('timeout', first), owner, id)).toEqual({
      result: 'timeout',
    });
    expect(await getConnector(deps(), owner, id)).toMatchObject({
      status: 'ok',
      lastTestResult: 'timeout',
      lastTestedAt: first,
      toolCount: 3,
    });

    // 오류 상태에서도 일시 장애는 상태를 바꾸지 않는다
    await retestConnector(testing('auth_failed', first), owner, id);
    const second = new Date('2026-11-06T02:00:00Z');
    await retestConnector(testing('upstream_error', second), owner, id);
    expect(await getConnector(deps(), owner, id)).toMatchObject({
      status: 'error',
      lastTestResult: 'upstream_error',
      lastTestedAt: second,
    });
  });

  it('재테스트가 auth_failed·unreachable·not_mcp·redirect면 커넥터 오류가 된다', async () => {
    const owner = await newUser();
    for (const result of ['auth_failed', 'unreachable', 'not_mcp', 'redirect'] as const) {
      const created = await createEndpoint(deps(), owner, {
        name: result,
        allowedTools: ['read_item'],
        connector: remoteInput(),
      });
      await retestConnector(testing(result, new Date()), owner, created.connector.id);
      expect((await getEndpoint(deps(), owner, created.id)).status).toBe('connector_error');
    }
  });

  it('이전 키로 만든 자격증명은 읽을 때 현재 키로 다시 암호화한다', async () => {
    const owner = await newUser();
    const created = await createEndpoint(deps(), owner, {
      name: 'a',
      allowedTools: ['read_item'],
      connector: remoteInput(),
    });
    const newKey = Buffer.alloc(32, 8).toString('base64');
    const rotating = createSecretBox({ current: newKey, previous: KEY });
    const select = () =>
      db.select().from(credentials).where(eq(credentials.connectorId, created.connector.id));
    const [before] = await select();
    expect(await loadCredentials({ db, secrets: rotating }, created.connector.id, owner)).toEqual({
      TOKEN: FAKE_UPSTREAM_TOKEN,
    });
    const [after] = await select();
    expect(rotating.needsRotation(after?.ciphertext ?? '')).toBe(false);
    expect(after?.updatedAt).toEqual(before?.updatedAt);
    // 이전 키를 빼도 읽힌다
    const rotated = createSecretBox({ current: newKey });
    expect(await loadCredentials({ db, secrets: rotated }, created.connector.id, owner)).toEqual({
      TOKEN: FAKE_UPSTREAM_TOKEN,
    });
  });
});
