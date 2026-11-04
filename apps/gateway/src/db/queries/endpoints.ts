import { and, desc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { connectors, endpoints } from '../schema.ts';

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
