import { randomToken, sha256Hex } from '../crypto/tokens.ts';
import type { Db } from '../db/client.ts';
import {
  deleteSession,
  findActiveSession,
  insertSession,
  touchSession,
} from '../db/queries/sessions.ts';

// lastSeenAt은 요청마다 쓰지 않고 최대 1분에 한 번 갱신한다
export const SESSION_TOUCH_INTERVAL_MS = 60_000;

export type SessionUser = NonNullable<Awaited<ReturnType<typeof findActiveSession>>>['user'];

// 쿠키에 넣을 무작위 토큰을 돌려준다. DB에는 SHA-256만 남는다 (F-AUTH-02)
export async function createSession(
  db: Db,
  userId: string,
  options: { now: Date; ttlHours: number },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(options.now.getTime() + options.ttlHours * 60 * 60 * 1000);
  await insertSession(db, { tokenHash: sha256Hex(token), userId, now: options.now, expiresAt });
  return { token, expiresAt };
}

export async function resolveSession(
  db: Db,
  token: string,
  now: Date,
): Promise<SessionUser | null> {
  const tokenHash = sha256Hex(token);
  const session = await findActiveSession(db, tokenHash, now);
  if (!session) return null;
  if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
    await touchSession(db, tokenHash, now);
  }
  return session.user;
}

export async function endSession(db: Db, token: string): Promise<void> {
  await deleteSession(db, sha256Hex(token));
}
