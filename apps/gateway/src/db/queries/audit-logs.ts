import { and, desc, eq, gte, ilike, lt, lte, or, type SQL, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { auditLogs, connectors, endpoints, users } from '../schema.ts';
import { escapeLike } from './like.ts';

// 툴 호출 하나. 인자·응답 본문은 받지도 않는다 (F-UI-03)
export async function insertAuditLog(
  db: DbOrTx,
  entry: Omit<typeof auditLogs.$inferInsert, 'id'>,
): Promise<void> {
  await db.insert(auditLogs).values(entry);
}

// 엔드포인트 상세의 최근 호출 (SCR-EP-03). 소유자 확인은 호출하는 쪽에서 끝낸다
export async function listRecentCalls(db: DbOrTx, endpointId: string, limit: number) {
  return db
    .select({
      at: auditLogs.at,
      toolName: auditLogs.toolName,
      result: auditLogs.result,
      durationMs: auditLogs.durationMs,
    })
    .from(auditLogs)
    .where(eq(auditLogs.endpointId, endpointId))
    .orderBy(desc(auditLogs.at), desc(auditLogs.id))
    .limit(limit);
}

export type AuditFilter = {
  from?: Date | undefined;
  to?: Date | undefined;
  userId?: string | undefined;
  endpointId?: string | undefined;
  connectorId?: string | undefined;
  result?: (typeof auditLogs.$inferSelect)['result'] | undefined;
  // 툴 이름 일부
  tool?: string | undefined;
};

// 이전 페이지 마지막 행. at은 DB의 마이크로초까지 맞추려고 Postgres 문자열 그대로 둔다
export type AuditCursor = { at: string; id: number };

function auditConditions(filter: AuditFilter): SQL | undefined {
  return and(
    filter.from ? gte(auditLogs.at, filter.from) : undefined,
    filter.to ? lte(auditLogs.at, filter.to) : undefined,
    filter.userId ? eq(auditLogs.userId, filter.userId) : undefined,
    filter.endpointId ? eq(auditLogs.endpointId, filter.endpointId) : undefined,
    filter.connectorId ? eq(auditLogs.connectorId, filter.connectorId) : undefined,
    filter.result ? eq(auditLogs.result, filter.result) : undefined,
    filter.tool ? ilike(auditLogs.toolName, `%${escapeLike(filter.tool)}%`) : undefined,
  );
}

// 감사 로그 목록 (SCR-ADM-06). 최신순, (at, id) 커서. 지워진 사용자·엔드포인트·커넥터는 null로 온다
export async function listAuditLogs(
  db: DbOrTx,
  filter: AuditFilter,
  cursor: AuditCursor | undefined,
  limit: number,
) {
  const cursorAt = cursor ? sql`${cursor.at}::timestamptz` : undefined;
  return db
    .select({
      id: auditLogs.id,
      at: auditLogs.at,
      cursorAt: sql<string>`${auditLogs.at}::text`,
      userId: auditLogs.userId,
      userEmail: users.email,
      userSub: users.sub,
      endpointId: auditLogs.endpointId,
      endpointName: endpoints.name,
      connectorId: auditLogs.connectorId,
      connectorName: sql<string | null>`${connectors.manifest}->>'name'`,
      toolName: auditLogs.toolName,
      result: auditLogs.result,
      durationMs: auditLogs.durationMs,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .leftJoin(endpoints, eq(endpoints.id, auditLogs.endpointId))
    .leftJoin(connectors, eq(connectors.id, auditLogs.connectorId))
    .where(
      and(
        auditConditions(filter),
        cursor && cursorAt
          ? or(
              lt(auditLogs.at, cursorAt),
              and(eq(auditLogs.at, cursorAt), lt(auditLogs.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(auditLogs.at), desc(auditLogs.id))
    .limit(limit);
}

// 감사 로그 요약: 호출·오류·거부 수와 소요시간 중앙값·95번째 백분위 (SCR-ADM-06)
export async function summarizeAuditLogs(db: DbOrTx, filter: AuditFilter) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      errors: sql<number>`(count(*) filter (where ${auditLogs.result} = 'error'))::int`,
      denied: sql<number>`(count(*) filter (where ${auditLogs.result} = 'denied'))::int`,
      p50: sql<number | null>`percentile_cont(0.5) within group (order by ${auditLogs.durationMs})`,
      p95: sql<
        number | null
      >`percentile_cont(0.95) within group (order by ${auditLogs.durationMs})`,
    })
    .from(auditLogs)
    .where(auditConditions(filter));
  if (!row) throw new Error('audit summary returned no row');
  return row;
}

// 보관 기간이 지난 기록 삭제 (AUDIT_RETENTION_DAYS)
export async function deleteAuditLogsBefore(db: DbOrTx, cutoff: Date): Promise<number> {
  const result = await db.delete(auditLogs).where(lt(auditLogs.at, cutoff));
  return result.count;
}
