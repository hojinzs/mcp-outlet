import { randomUUID } from 'node:crypto';
import { connectorManifestSchema } from '@mcp-outlet/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { insertConnector } from '../db/queries/connectors.ts';
import { insertEndpoint } from '../db/queries/endpoints.ts';
import { activityLogs, connectors, credentials, users } from '../db/schema.ts';
import { testDatabaseUrl, useTestDb } from '../testing/db.ts';
import {
  listUserConnectors,
  listUserEndpoints,
  listUsers,
  maskRemoteUrl,
  setConnectorDisabledByAdmin,
} from './admin-users.ts';
import { ServiceError } from './errors.ts';

describe('maskRemoteUrl', () => {
  it('쿼리 값과 사용자 정보를 가리고 경로는 남긴다', () => {
    expect(maskRemoteUrl('https://user:pass@mcp.example.com/mcp?token=abc&team=1#frag')).toBe(
      'https://***@mcp.example.com/mcp?token=***&team=***',
    );
    expect(maskRemoteUrl('https://mcp.example.com/mcp')).toBe('https://mcp.example.com/mcp');
    expect(maskRemoteUrl('not a url')).toBe('');
  });
});

describe.skipIf(!testDatabaseUrl)('관리자 사용자·커넥터 서비스 (DB)', () => {
  const db = useTestDb();
  const now = new Date('2026-11-05T00:00:00Z');
  const deps = { db, now: () => now };

  async function newUser(tag: string, values: Partial<typeof users.$inferInsert> = {}) {
    const sub = `${tag}-${randomUUID()}`;
    const [user] = await db
      .insert(users)
      .values({ sub, email: `${sub}@admin.test`, groups: ['Outlet Users'], ...values })
      .returning({ id: users.id, sub: users.sub, email: users.email });
    if (!user) throw new Error('no user');
    return user;
  }

  async function newConnector(ownerId: string, url = 'https://mcp.example.com/mcp?key=secret') {
    const manifest = connectorManifestSchema.parse({
      manifestVersion: 1,
      name: 'CMS',
      runtime: 'remote',
      url,
      credentials: [],
      auth: { type: 'none' },
    });
    return insertConnector(db, { ownerId, runtime: 'remote', manifest, status: 'ok' });
  }

  it('사용자별 커넥터·엔드포인트·중지 수와 최근 호출을 주고, 최근 호출순 뒤에 로그인순으로 정렬한다', async () => {
    const tag = `list-${randomUUID().slice(0, 8)}`;
    const idle = await newUser(tag, { lastLoginAt: new Date('2026-11-04T00:00:00Z') });
    const older = await newUser(tag, { lastLoginAt: new Date('2026-11-03T00:00:00Z') });
    const busy = await newUser(tag, { role: 'admin' });
    const connector = await newConnector(busy.id);
    await newConnector(busy.id);
    await insertEndpoint(db, {
      ownerId: busy.id,
      connectorId: connector.id,
      name: 'a',
      lastCalledAt: new Date('2026-11-04T12:00:00Z'),
    });
    await insertEndpoint(db, { ownerId: busy.id, connectorId: connector.id, name: 'b' });
    await db
      .update(connectors)
      .set({ disabledAt: now, disabledReason: 'abuse' })
      .where(eq(connectors.id, connector.id));

    const rows = await listUsers(deps, { query: tag });
    expect(rows.map((row) => row.id)).toEqual([busy.id, idle.id, older.id]);
    expect(rows[0]).toMatchObject({
      role: 'admin',
      connectorCount: 2,
      disabledConnectorCount: 1,
      endpointCount: 2,
      lastCalledAt: new Date('2026-11-04T12:00:00Z'),
    });
    expect(rows[1]).toMatchObject({ connectorCount: 0, endpointCount: 0, lastCalledAt: null });

    const disabledOnly = await listUsers(deps, { query: tag, disabledOnly: true });
    expect(disabledOnly.map((row) => row.id)).toEqual([busy.id]);
    // 검색어의 %·_는 와일드카드가 아니다
    expect(await listUsers(deps, { query: `${tag}%` })).toEqual([]);
  });

  it('커넥터 목록은 URL을 가리고 자격증명·연결 계정을 담지 않는다', async () => {
    const owner = await newUser('conn');
    const connector = await newConnector(owner.id);
    await db.insert(credentials).values({
      connectorId: connector.id,
      scope: 'user',
      userId: owner.id,
      ciphertext: 'v1.k.cipher-should-not-leak',
      account: 'owner@private.test',
    });
    const list = await listUserConnectors(deps, owner.id);
    expect(list).toEqual([
      expect.objectContaining({
        id: connector.id,
        name: 'CMS',
        runtime: 'remote',
        builtin: null,
        url: 'https://mcp.example.com/mcp?key=***',
        status: 'ok',
        disabled: null,
        endpointCount: 0,
      }),
    ]);
    const body = JSON.stringify(list);
    expect(body).not.toContain('cipher-should-not-leak');
    expect(body).not.toContain('owner@private.test');
    expect(body).not.toContain('secret');
  });

  it('없는 사용자는 not_found', async () => {
    await expect(listUserConnectors(deps, randomUUID())).rejects.toEqual(
      new ServiceError('not_found'),
    );
    await expect(listUserEndpoints(deps, randomUUID())).rejects.toEqual(
      new ServiceError('not_found'),
    );
  });

  it('사용 중지·다시 사용은 상태가 바뀔 때만 작업 기록에 남긴다', async () => {
    const admin = await newUser('admin', { role: 'admin' });
    const owner = await newUser('owner');
    const connector = await newConnector(owner.id);
    const logs = () =>
      db
        .select({
          actorId: activityLogs.actorId,
          action: activityLogs.action,
          targetType: activityLogs.targetType,
          reason: activityLogs.reason,
        })
        .from(activityLogs)
        .where(eq(activityLogs.targetId, connector.id))
        .orderBy(activityLogs.id);

    const disabled = await setConnectorDisabledByAdmin(deps, admin.id, connector.id, {
      disabled: true,
      reason: '외부 유출 의심',
    });
    expect(disabled.disabled).toEqual({
      at: now,
      reason: '외부 유출 의심',
      by: { id: admin.id, email: admin.email, sub: admin.sub },
    });
    // 이미 중지된 커넥터를 다시 중지해도 사유·기록이 바뀌지 않는다
    await setConnectorDisabledByAdmin(deps, admin.id, connector.id, {
      disabled: true,
      reason: '다른 사유',
    });
    const enabled = await setConnectorDisabledByAdmin(deps, admin.id, connector.id, {
      disabled: false,
    });
    expect(enabled.disabled).toBeNull();

    expect(await logs()).toEqual([
      {
        actorId: admin.id,
        action: 'connector.disable',
        targetType: 'connector',
        reason: '외부 유출 의심',
      },
      { actorId: admin.id, action: 'connector.enable', targetType: 'connector', reason: null },
    ]);
    await expect(
      setConnectorDisabledByAdmin(deps, admin.id, randomUUID(), { disabled: false }),
    ).rejects.toEqual(new ServiceError('not_found'));
  });
});
