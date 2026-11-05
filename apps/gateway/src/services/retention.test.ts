import { randomUUID } from 'node:crypto';
import { connectorManifestSchema } from '@mcp-outlet/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { insertConnector } from '../db/queries/connectors.ts';
import { insertEndpoint } from '../db/queries/endpoints.ts';
import { activityLogs, auditLogs, connectors, sessions, users } from '../db/schema.ts';
import { testDatabaseUrl, useTestDb } from '../testing/db.ts';
import { purgeExpiredRecords } from './retention.ts';

describe.skipIf(!testDatabaseUrl)('보관 주기 작업 (DB)', () => {
  const db = useTestDb();
  // 다른 테스트 기록을 건드리지 않도록 아주 오래전 시각으로 만든다
  const now = () => new Date('2000-01-10T00:00:00Z');

  async function seed() {
    const tool = `retention-${randomUUID()}`;
    const target = randomUUID();
    const old = new Date('1999-12-01T00:00:00Z');
    const recent = new Date('2000-01-09T00:00:00Z');
    await db.insert(auditLogs).values([
      { at: old, toolName: tool, result: 'ok', durationMs: 1 },
      { at: recent, toolName: tool, result: 'ok', durationMs: 1 },
    ]);
    await db.insert(activityLogs).values([
      { at: old, action: 'connector.enable', targetType: 'connector', targetId: target },
      { at: recent, action: 'connector.enable', targetType: 'connector', targetId: target },
    ]);
    return {
      audit: () => db.$count(auditLogs, eq(auditLogs.toolName, tool)),
      activity: () => db.$count(activityLogs, eq(activityLogs.targetId, target)),
    };
  }

  async function newUser() {
    const [user] = await db
      .insert(users)
      .values({ sub: `retention-${randomUUID()}`, groups: [] })
      .returning({ id: users.id });
    if (!user) throw new Error('no user');
    return user;
  }

  const manifest = connectorManifestSchema.parse({
    manifestVersion: 1,
    name: 'GA',
    runtime: 'builtin',
    builtin: 'google-analytics',
    credentials: [],
    auth: { type: 'none' },
  });

  function pendingConnector(ownerId: string, createdAt: Date) {
    return insertConnector(db, {
      ownerId,
      runtime: 'builtin',
      manifest,
      status: 'pending',
      createdAt,
    });
  }

  it('보관 기간이 지난 감사 로그·작업 기록만 지운다', async () => {
    const counts = await seed();
    await purgeExpiredRecords({ db, now }, { audit: 30, activity: 30 });
    expect(await counts.audit()).toBe(1);
    expect(await counts.activity()).toBe(1);
  });

  it('0일이면 기록을 지우지 않는다', async () => {
    const counts = await seed();
    const deleted = await purgeExpiredRecords({ db, now }, { audit: 0, activity: 0 });
    expect(deleted).toMatchObject({ audit: 0, activity: 0 });
    expect(await counts.audit()).toBe(2);
    expect(await counts.activity()).toBe(2);
  });

  it('만료된 세션만 지운다', async () => {
    const user = await newUser();
    const session = (expiresAt: Date) => ({
      tokenHash: randomUUID(),
      userId: user.id,
      createdAt: new Date('1999-12-31T00:00:00Z'),
      lastSeenAt: new Date('1999-12-31T00:00:00Z'),
      expiresAt,
    });
    await db
      .insert(sessions)
      .values([
        session(new Date('2000-01-09T00:00:00Z')),
        session(new Date('2000-01-11T00:00:00Z')),
      ]);
    await purgeExpiredRecords({ db, now }, { audit: 0, activity: 0 });
    const left = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(left.map((row) => row.expiresAt)).toEqual([new Date('2000-01-11T00:00:00Z')]);
  });

  it('24시간 넘게 엔드포인트 없이 연결 중으로 남은 커넥터만 지운다', async () => {
    const user = await newUser();
    const stale = await pendingConnector(user.id, new Date('2000-01-08T00:00:00Z'));
    const fresh = await pendingConnector(user.id, new Date('2000-01-09T12:00:00Z'));
    const used = await pendingConnector(user.id, new Date('2000-01-08T00:00:00Z'));
    await insertEndpoint(db, { ownerId: user.id, connectorId: used.id, name: 'GA' });
    const connected = await insertConnector(db, {
      ownerId: user.id,
      runtime: 'builtin',
      manifest,
      status: 'ok',
      createdAt: new Date('2000-01-01T00:00:00Z'),
    });

    await purgeExpiredRecords({ db, now }, { audit: 0, activity: 0 });
    const left = await db
      .select({ id: connectors.id })
      .from(connectors)
      .where(eq(connectors.ownerId, user.id));
    expect(left.map((row) => row.id).sort()).toEqual([fresh.id, used.id, connected.id].sort());
    expect(left.map((row) => row.id)).not.toContain(stale.id);
  });
});
