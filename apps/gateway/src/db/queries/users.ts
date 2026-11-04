import { eq } from 'drizzle-orm';
import type { Role } from '../../auth/access.ts';
import type { Db } from '../client.ts';
import { users } from '../schema.ts';

export type LoginProfile = {
  sub: string;
  email: string | null;
  groups: string[];
  role: Role;
};

// 첫 로그인이면 만들고, 이후에는 IdP 클레임으로 email·groups·role을 덮어쓴다
export async function upsertUserOnLogin(db: Db, profile: LoginProfile, now: Date) {
  const values = {
    email: profile.email,
    groups: profile.groups,
    role: profile.role,
    lastLoginAt: now,
  };
  const [user] = await db
    .insert(users)
    .values({ sub: profile.sub, ...values })
    .onConflictDoUpdate({ target: users.sub, set: values })
    .returning({ id: users.id });
  if (!user) throw new Error('user upsert returned no row');
  return user;
}

export async function findUserBySub(db: Db, sub: string) {
  const [row] = await db
    .select({ id: users.id, email: users.email, groups: users.groups, role: users.role })
    .from(users)
    .where(eq(users.sub, sub));
  return row;
}

// MCP 요청 때 바뀐 클레임만 쓴다. lastLoginAt·updatedAt은 관리 UI 로그인 기준이라 그대로 둔다
export async function updateUserClaims(
  db: Db,
  id: string,
  changes: Partial<{ email: string | null; groups: string[]; role: Role }>,
): Promise<void> {
  await db
    .update(users)
    .set({ ...changes, updatedAt: users.updatedAt })
    .where(eq(users.id, id));
}
