import { and, desc, eq, inArray, isNotNull, isNull, lt, ne, notExists } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { CachedTool } from '../../runtimes/types.ts';
import type { DbOrTx } from '../client.ts';
import { connectors, credentials, endpoints, users } from '../schema.ts';

// 개인 커넥터 조회·변경. 모든 조회와 변경은 ownerId 조건을 함께 건다

export type ConnectorRow = typeof connectors.$inferSelect;
export type NewConnector = typeof connectors.$inferInsert;
export type ConnectorChanges = Partial<
  Pick<
    NewConnector,
    'manifest' | 'toolsCache' | 'toolsCachedAt' | 'status' | 'lastTestedAt' | 'lastTestResult'
  >
>;

export async function countConnectors(db: DbOrTx, ownerId: string): Promise<number> {
  return db.$count(connectors, eq(connectors.ownerId, ownerId));
}

function selectWithCounts(db: DbOrTx) {
  return db
    .select({
      connector: connectors,
      credentialUpdatedAt: credentials.updatedAt,
      credentialAccount: credentials.account,
      endpointCount: db.$count(endpoints, eq(endpoints.connectorId, connectors.id)),
    })
    .from(connectors)
    .leftJoin(
      credentials,
      and(eq(credentials.connectorId, connectors.id), eq(credentials.userId, connectors.ownerId)),
    );
}

export async function listConnectors(db: DbOrTx, ownerId: string) {
  return selectWithCounts(db)
    .where(eq(connectors.ownerId, ownerId))
    .orderBy(desc(connectors.updatedAt));
}

export async function findConnector(db: DbOrTx, ownerId: string, id: string) {
  const [row] = await selectWithCounts(db).where(
    and(eq(connectors.id, id), eq(connectors.ownerId, ownerId)),
  );
  return row;
}

export async function insertConnector(db: DbOrTx, values: NewConnector): Promise<ConnectorRow> {
  const [row] = await db.insert(connectors).values(values).returning();
  if (!row) throw new Error('connector insert returned no row');
  return row;
}

export async function updateConnector(
  db: DbOrTx,
  ownerId: string,
  id: string,
  changes: ConnectorChanges,
): Promise<void> {
  await db
    .update(connectors)
    .set(changes)
    .where(and(eq(connectors.id, id), eq(connectors.ownerId, ownerId)));
}

// 엔드포인트·자격증명은 FK cascade로 함께 지워진다 (F-CON-04)
export async function deleteConnector(db: DbOrTx, ownerId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(connectors)
    .where(and(eq(connectors.id, id), eq(connectors.ownerId, ownerId)))
    .returning({ id: connectors.id });
  return deleted.length > 0;
}

// 업스트림 OAuth 동의 전에 저장했다가 엔드포인트를 만들지 않고 남은 커넥터 (SCR-EP-02).
// ownerId를 빼면 모든 사용자 것을 지운다(보관 주기 작업). 지운 행 수를 돌려준다
export async function deleteStalePendingConnectors(
  db: DbOrTx,
  createdBefore: Date,
  ownerId?: string,
): Promise<number> {
  const deleted = await db
    .delete(connectors)
    .where(
      and(
        ownerId ? eq(connectors.ownerId, ownerId) : undefined,
        eq(connectors.status, 'pending'),
        lt(connectors.createdAt, createdBefore),
        notExists(db.select().from(endpoints).where(eq(endpoints.connectorId, connectors.id))),
      ),
    )
    .returning({ id: connectors.id });
  return deleted.length;
}

// 업스트림 토큰 갱신이 거부되면 사용자가 다시 연결할 때까지 재연결 필요로 둔다 (F-RUN-03)
export async function markReauthRequired(db: DbOrTx, id: string): Promise<void> {
  await db
    .update(connectors)
    .set({ status: 'reauth_required', updatedAt: connectors.updatedAt })
    .where(and(eq(connectors.id, id), ne(connectors.status, 'reauth_required')));
}

// MCP 호출 결과로 정상·오류를 오간다. pending·reauth_required는 호출 결과로 바꾸지 않고,
// 같은 값이면 쓰지 않는다. 목록 정렬이 바뀌지 않게 updatedAt은 그대로 둔다
export async function setConnectorHealth(
  db: DbOrTx,
  id: string,
  status: 'ok' | 'error',
): Promise<void> {
  await db
    .update(connectors)
    .set({ status, updatedAt: connectors.updatedAt })
    .where(
      and(
        eq(connectors.id, id),
        inArray(connectors.status, ['ok', 'error']),
        ne(connectors.status, status),
      ),
    );
}

// 프록시를 지나는 tools/list로 툴 캐시를 바꾼다. 사용자가 바꾼 것이 아니라 updatedAt은 그대로 둔다
export async function setConnectorToolsCache(
  db: DbOrTx,
  id: string,
  tools: CachedTool[],
  now: Date,
): Promise<void> {
  await db
    .update(connectors)
    .set({ toolsCache: tools, toolsCachedAt: now, updatedAt: connectors.updatedAt })
    .where(eq(connectors.id, id));
}

// 관리자 화면: 한 사용자의 커넥터와 사용 중지한 관리자 (SCR-ADM-04). 자격증명 테이블은 읽지 않는다
export async function listConnectorsForAdmin(db: DbOrTx, ownerId: string) {
  const disabler = alias(users, 'disabler');
  return db
    .select({
      connector: connectors,
      endpointCount: db.$count(endpoints, eq(endpoints.connectorId, connectors.id)),
      disabledByEmail: disabler.email,
      disabledBySub: disabler.sub,
    })
    .from(connectors)
    .leftJoin(disabler, eq(disabler.id, connectors.disabledBy))
    .where(eq(connectors.ownerId, ownerId))
    .orderBy(desc(connectors.updatedAt));
}

export async function findConnectorOwner(db: DbOrTx, id: string) {
  const [row] = await db
    .select({ id: connectors.id, ownerId: connectors.ownerId })
    .from(connectors)
    .where(eq(connectors.id, id));
  return row;
}

export type ConnectorDisable = { disabledBy: string; disabledReason: string; disabledAt: Date };

// 관리자 사용 중지·다시 사용. 이미 그 상태면 바꾸지 않고 false를 돌려준다.
// 사용자 목록 정렬이 바뀌지 않게 updatedAt은 그대로 둔다
export async function setConnectorDisabled(
  db: DbOrTx,
  id: string,
  disable: ConnectorDisable | null,
): Promise<boolean> {
  const changed = await db
    .update(connectors)
    .set({
      disabledAt: disable?.disabledAt ?? null,
      disabledBy: disable?.disabledBy ?? null,
      disabledReason: disable?.disabledReason ?? null,
      updatedAt: connectors.updatedAt,
    })
    .where(
      and(
        eq(connectors.id, id),
        disable ? isNull(connectors.disabledAt) : isNotNull(connectors.disabledAt),
      ),
    )
    .returning({ id: connectors.id });
  return changed.length > 0;
}
