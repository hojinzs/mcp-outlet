import { and, desc, eq, inArray, lt, ne, notExists } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { connectors, credentials, endpoints } from '../schema.ts';

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

// 업스트림 OAuth 동의 전에 저장했다가 엔드포인트를 만들지 않고 남은 커넥터 (SCR-EP-02)
export async function deleteStalePendingConnectors(
  db: DbOrTx,
  ownerId: string,
  createdBefore: Date,
): Promise<void> {
  await db
    .delete(connectors)
    .where(
      and(
        eq(connectors.ownerId, ownerId),
        eq(connectors.status, 'pending'),
        lt(connectors.createdAt, createdBefore),
        notExists(db.select().from(endpoints).where(eq(endpoints.connectorId, connectors.id))),
      ),
    );
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
