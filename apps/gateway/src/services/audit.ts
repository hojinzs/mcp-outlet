import { z } from 'zod';
import type { Db } from '../db/client.ts';
import {
  type AuditCursor,
  type AuditFilter,
  listAuditLogs,
  summarizeAuditLogs,
} from '../db/queries/audit-logs.ts';
import { ServiceError } from './errors.ts';

// 감사 로그 조회와 요약 (SCR-ADM-06, F-UI-03). 저장된 칸이 시각·사용자·엔드포인트·커넥터·툴·결과·소요시간뿐이다

export const AUDIT_PAGE_SIZE = 50;

const cursorSchema = z.object({ at: z.string().min(1).max(64), id: z.number().int().positive() });

// 화면에는 불투명한 문자열로 준다
function encodeCursor(cursor: AuditCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value: string): AuditCursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw new ServiceError('invalid_request');
  }
}

type AuditRow = Awaited<ReturnType<typeof listAuditLogs>>[number];

// 지워진 사용자·엔드포인트·커넥터는 null이다. 화면이 "삭제된 …"으로 보여준다
function auditEntryView(row: AuditRow) {
  return {
    id: row.id,
    at: row.at,
    user: row.userId ? { id: row.userId, email: row.userEmail, sub: row.userSub } : null,
    endpoint: row.endpointId ? { id: row.endpointId, name: row.endpointName } : null,
    connector: row.connectorId ? { id: row.connectorId, name: row.connectorName } : null,
    toolName: row.toolName,
    result: row.result,
    durationMs: row.durationMs,
  };
}

export async function listAudit(deps: { db: Db }, filter: AuditFilter, cursor: string | undefined) {
  const rows = await listAuditLogs(
    deps.db,
    filter,
    cursor ? decodeCursor(cursor) : undefined,
    AUDIT_PAGE_SIZE + 1,
  );
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  const last = page.at(-1);
  return {
    entries: page.map(auditEntryView),
    nextCursor:
      rows.length > AUDIT_PAGE_SIZE && last
        ? encodeCursor({ at: last.cursorAt, id: last.id })
        : null,
  };
}

export async function summarizeAudit(deps: { db: Db; retentionDays: number }, filter: AuditFilter) {
  const summary = await summarizeAuditLogs(deps.db, filter);
  const round = (value: number | null) => (value === null ? null : Math.round(value));
  return {
    total: summary.total,
    errors: summary.errors,
    denied: summary.denied,
    durationMs: { p50: round(summary.p50), p95: round(summary.p95) },
    // 화면 하단의 보관 기간 안내. 0이면 지우지 않는다
    retentionDays: deps.retentionDays,
  };
}
