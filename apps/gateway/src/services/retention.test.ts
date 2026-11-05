import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { activityLogs, auditLogs } from '../db/schema.ts';
import { testDatabaseUrl, useTestDb } from '../testing/db.ts';
import { purgeExpiredLogs } from './retention.ts';

describe.skipIf(!testDatabaseUrl)('기록 보관 기간 (DB)', () => {
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

  it('보관 기간이 지난 감사 로그·작업 기록만 지운다', async () => {
    const counts = await seed();
    await purgeExpiredLogs({ db, now }, { audit: 30, activity: 30 });
    expect(await counts.audit()).toBe(1);
    expect(await counts.activity()).toBe(1);
  });

  it('0일이면 지우지 않는다', async () => {
    const counts = await seed();
    expect(await purgeExpiredLogs({ db, now }, { audit: 0, activity: 0 })).toEqual({
      audit: 0,
      activity: 0,
    });
    expect(await counts.audit()).toBe(2);
    expect(await counts.activity()).toBe(2);
  });
});
