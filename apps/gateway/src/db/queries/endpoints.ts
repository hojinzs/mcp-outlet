import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { connectors, endpoints, users } from '../schema.ts';

// 엔드포인트 조회·변경. 모든 조회와 변경은 ownerId 조건을 함께 건다

export type EndpointRow = typeof endpoints.$inferSelect;
export type EndpointChanges = Partial<
  Pick<typeof endpoints.$inferInsert, 'name' | 'allowedTools' | 'knownTools' | 'enabled'>
>;

export async function countEndpoints(db: DbOrTx, ownerId: string): Promise<number> {
  return db.$count(endpoints, eq(endpoints.ownerId, ownerId));
}

export async function countConnectorEndpoints(db: DbOrTx, connectorId: string): Promise<number> {
  return db.$count(endpoints, eq(endpoints.connectorId, connectorId));
}

function selectWithConnector(db: DbOrTx) {
  return db
    .select({ endpoint: endpoints, connector: connectors })
    .from(endpoints)
    .innerJoin(connectors, eq(connectors.id, endpoints.connectorId));
}

export async function listEndpoints(db: DbOrTx, ownerId: string) {
  return selectWithConnector(db)
    .where(eq(endpoints.ownerId, ownerId))
    .orderBy(desc(endpoints.updatedAt));
}

export async function findEndpoint(db: DbOrTx, ownerId: string, id: string) {
  const [row] = await selectWithConnector(db).where(
    and(eq(endpoints.id, id), eq(endpoints.ownerId, ownerId)),
  );
  return row;
}

// MCP 요청 경로: 토큰의 sub와 비교하도록 소유자의 sub를 함께 읽는다 (F-AUTH-05)
export async function findEndpointForMcp(db: DbOrTx, id: string) {
  const [row] = await db
    .select({ endpoint: endpoints, connector: connectors, ownerSub: users.sub })
    .from(endpoints)
    .innerJoin(connectors, eq(connectors.id, endpoints.connectorId))
    .innerJoin(users, eq(users.id, endpoints.ownerId))
    .where(eq(endpoints.id, id));
  return row;
}

export async function insertEndpoint(
  db: DbOrTx,
  values: typeof endpoints.$inferInsert,
): Promise<EndpointRow> {
  const [row] = await db.insert(endpoints).values(values).returning();
  if (!row) throw new Error('endpoint insert returned no row');
  return row;
}

export async function updateEndpoint(
  db: DbOrTx,
  ownerId: string,
  id: string,
  changes: EndpointChanges,
): Promise<void> {
  await db
    .update(endpoints)
    .set(changes)
    .where(and(eq(endpoints.id, id), eq(endpoints.ownerId, ownerId)));
}

export async function deleteEndpoint(db: DbOrTx, ownerId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(endpoints)
    .where(and(eq(endpoints.id, id), eq(endpoints.ownerId, ownerId)))
    .returning({ id: endpoints.id });
  return deleted.length > 0;
}

// 호출마다 쓰지 않고 최대 intervalMs에 한 번. 목록 정렬(최근 수정순)이 바뀌지 않게 updatedAt은 그대로 둔다
export async function touchLastCalled(
  db: DbOrTx,
  ids: { endpointId: string; connectorId: string },
  now: Date,
  intervalMs: number,
): Promise<void> {
  const before = new Date(now.getTime() - intervalMs);
  await db
    .update(endpoints)
    .set({ lastCalledAt: now, updatedAt: endpoints.updatedAt })
    .where(
      and(
        eq(endpoints.id, ids.endpointId),
        or(isNull(endpoints.lastCalledAt), lt(endpoints.lastCalledAt, before)),
      ),
    );
  await db
    .update(connectors)
    .set({ lastCalledAt: now, updatedAt: connectors.updatedAt })
    .where(
      and(
        eq(connectors.id, ids.connectorId),
        or(isNull(connectors.lastCalledAt), lt(connectors.lastCalledAt, before)),
      ),
    );
}
