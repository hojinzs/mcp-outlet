import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../crypto/tokens.ts';
import { deleteExpiredSessions } from '../db/queries/sessions.ts';
import { upsertUserOnLogin } from '../db/queries/users.ts';
import { sessions } from '../db/schema.ts';
import { testDatabaseUrl, useTestDb } from '../testing/db.ts';
import { createSession, endSession, resolveSession } from './sessions.ts';

const t0 = new Date('2026-11-04T00:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);
const HOUR = 60 * 60 * 1000;

describe.skipIf(!testDatabaseUrl)('sessions (DB)', () => {
  const db = useTestDb();

  async function newUser(role: 'user' | 'admin' = 'user') {
    const profile = { sub: `sub-${randomUUID()}`, email: 'a@test', groups: ['g'], role };
    return upsertUserOnLogin(db, profile, t0);
  }

  async function lastSeenOf(token: string) {
    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, sha256Hex(token)));
    return row?.lastSeenAt;
  }

  it('DB에는 토큰이 아니라 해시만 저장한다', async () => {
    const user = await newUser();
    const { token } = await createSession(db, user.id, { now: t0, ttlHours: 1 });
    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(sha256Hex(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('만료 전에는 사용자를, 만료 후에는 null을 돌려준다', async () => {
    const user = await newUser('admin');
    const { token } = await createSession(db, user.id, { now: t0, ttlHours: 1 });
    expect(await resolveSession(db, token, at(1000))).toMatchObject({ id: user.id, role: 'admin' });
    expect(await resolveSession(db, token, at(HOUR))).toBeNull();
    expect(await resolveSession(db, 'unknown', at(1000))).toBeNull();
  });

  it('lastSeenAt은 1분 간격으로만 갱신한다', async () => {
    const user = await newUser();
    const { token } = await createSession(db, user.id, { now: t0, ttlHours: 1 });
    await resolveSession(db, token, at(30_000));
    expect(await lastSeenOf(token)).toEqual(t0);
    await resolveSession(db, token, at(61_000));
    expect(await lastSeenOf(token)).toEqual(at(61_000));
  });

  it('세션을 지우면 바로 무효가 된다', async () => {
    const user = await newUser();
    const { token } = await createSession(db, user.id, { now: t0, ttlHours: 1 });
    await endSession(db, token);
    expect(await resolveSession(db, token, at(1000))).toBeNull();
  });

  it('만료 세션만 정리한다', async () => {
    const user = await newUser();
    const old = await createSession(db, user.id, { now: at(-10 * HOUR), ttlHours: 1 });
    const live = await createSession(db, user.id, { now: t0, ttlHours: 1 });
    expect(await deleteExpiredSessions(db, at(1000))).toBeGreaterThanOrEqual(1);
    expect(await lastSeenOf(old.token)).toBeUndefined();
    expect(await lastSeenOf(live.token)).toEqual(t0);
  });
});
