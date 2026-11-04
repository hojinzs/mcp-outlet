import { desc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { auditLogs } from '../schema.ts';

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
