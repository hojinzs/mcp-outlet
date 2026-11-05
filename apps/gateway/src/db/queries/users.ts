import { and, eq, exists, ilike, isNotNull, max, or, sql } from 'drizzle-orm';
import type { Role } from '../../auth/access.ts';
import type { Db } from '../client.ts';
import { connectors, endpoints, users } from '../schema.ts';
import { escapeLike } from './like.ts';

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

export async function findUserById(db: Db, id: string) {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, id));
  return row;
}

// 관리자 사용자 목록 (SCR-ADM-04). 사용자가 100명을 넘을 일이 드물어 한 번에 읽는다
export async function listUsersWithStats(
  db: Db,
  filter: { query?: string | undefined; disabledOnly?: boolean | undefined },
) {
  // 이 사용자의 엔드포인트 중 가장 최근 호출
  const lastCalls = db
    .select({
      ownerId: endpoints.ownerId,
      lastCalledAt: max(endpoints.lastCalledAt).as('last_called_at'),
    })
    .from(endpoints)
    .groupBy(endpoints.ownerId)
    .as('last_calls');
  const hasDisabled = exists(
    db
      .select({ id: connectors.id })
      .from(connectors)
      .where(and(eq(connectors.ownerId, users.id), isNotNull(connectors.disabledAt))),
  );
  const pattern = filter.query ? `%${escapeLike(filter.query)}%` : undefined;
  return (
    db
      .select({
        id: users.id,
        sub: users.sub,
        email: users.email,
        role: users.role,
        groups: users.groups,
        lastLoginAt: users.lastLoginAt,
        connectorCount: db.$count(connectors, eq(connectors.ownerId, users.id)),
        disabledConnectorCount: db.$count(
          connectors,
          and(eq(connectors.ownerId, users.id), isNotNull(connectors.disabledAt)),
        ),
        endpointCount: db.$count(endpoints, eq(endpoints.ownerId, users.id)),
        lastCalledAt: lastCalls.lastCalledAt,
      })
      .from(users)
      .leftJoin(lastCalls, eq(lastCalls.ownerId, users.id))
      .where(
        and(
          pattern ? or(ilike(users.email, pattern), ilike(users.sub, pattern)) : undefined,
          filter.disabledOnly ? hasDisabled : undefined,
        ),
      )
      // 최근 호출순, 호출이 없는 사용자는 마지막 로그인순으로 뒤에 둔다
      .orderBy(
        sql`${lastCalls.lastCalledAt} desc nulls last`,
        sql`${users.lastLoginAt} desc nulls last`,
        users.id,
      )
  );
}
