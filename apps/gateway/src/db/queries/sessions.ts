import { and, eq, gt, lte } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { sessions, users } from '../schema.ts';

export async function insertSession(
  db: Db,
  session: { tokenHash: string; userId: string; now: Date; expiresAt: Date },
): Promise<void> {
  await db.insert(sessions).values({
    tokenHash: session.tokenHash,
    userId: session.userId,
    createdAt: session.now,
    lastSeenAt: session.now,
    expiresAt: session.expiresAt,
  });
}

// 만료 전 세션과 그 사용자의 현재 role. role은 매 요청 DB 값을 쓴다
export async function findActiveSession(db: Db, tokenHash: string, now: Date) {
  const [row] = await db
    .select({
      lastSeenAt: sessions.lastSeenAt,
      user: { id: users.id, email: users.email, role: users.role, groups: users.groups },
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)));
  return row;
}

export async function touchSession(db: Db, tokenHash: string, now: Date): Promise<void> {
  await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.tokenHash, tokenHash));
}

export async function deleteSession(db: Db, tokenHash: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

// 보관 주기 작업에서 부른다. 지운 행 수를 돌려준다
export async function deleteExpiredSessions(db: Db, now: Date): Promise<number> {
  const deleted = await db
    .delete(sessions)
    .where(lte(sessions.expiresAt, now))
    .returning({ tokenHash: sessions.tokenHash });
  return deleted.length;
}

// 로그인 허용 그룹에서 빠진 사용자의 관리 UI 세션을 모두 끝낸다 (F-AUTH-06)
export async function deleteUserSessions(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
