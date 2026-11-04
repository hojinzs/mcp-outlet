import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { sessions, users } from '../db/schema.ts';
import { testDatabaseUrl, useTestDb } from '../testing/db.ts';
import { completeLogin } from './login.ts';

const now = new Date('2026-11-04T00:00:00Z');
const policy = { groupsClaim: 'groups', loginGroups: ['Users', 'Admins'], adminGroups: ['Admins'] };
const options = { policy, ttlHours: 1, now };

describe.skipIf(!testDatabaseUrl)('completeLogin (DB)', () => {
  const db = useTestDb();

  async function userBySub(sub: string) {
    const [user] = await db.select().from(users).where(eq(users.sub, sub));
    return user;
  }

  it('허용 그룹이면 사용자를 갱신하고 세션을 만든다', async () => {
    const sub = `sub-${randomUUID()}`;
    await completeLogin(db, { sub, email: 'old@test', groups: ['Users'] }, options);
    const result = await completeLogin(
      db,
      { sub, email: 'new@test', groups: ['Users', 'Admins'] },
      options,
    );
    expect(result.kind).toBe('ok');
    const user = await userBySub(sub);
    expect(user).toMatchObject({ email: 'new@test', groups: ['Users', 'Admins'], role: 'admin' });
    expect(user?.lastLoginAt).toEqual(now);
  });

  it('허용 그룹 밖이면 사용자도 세션도 만들지 않는다', async () => {
    const sub = `sub-${randomUUID()}`;
    const result = await completeLogin(db, { sub, email: 'x@test', groups: ['Other'] }, options);
    expect(result).toEqual({ kind: 'denied', email: 'x@test' });
    expect(await userBySub(sub)).toBeUndefined();
  });

  it('그룹에서 빠진 기존 사용자에게 새 세션을 만들지 않는다', async () => {
    const sub = `sub-${randomUUID()}`;
    await completeLogin(db, { sub, groups: ['Users'] }, options);
    const user = await userBySub(sub);
    expect(await completeLogin(db, { sub, groups: [] }, options)).toMatchObject({ kind: 'denied' });
    const rows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user?.id ?? ''));
    expect(rows).toHaveLength(1);
  });
});
