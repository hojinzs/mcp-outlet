import type { Db } from '../db/client.ts';
import { deleteActivityLogsBefore } from '../db/queries/activity-logs.ts';
import { deleteAuditLogsBefore } from '../db/queries/audit-logs.ts';
import { deleteStalePendingConnectors } from '../db/queries/connectors.ts';
import { deleteExpiredSessions } from '../db/queries/sessions.ts';
import { PENDING_TTL_MS } from './upstream-oauth.ts';

// 보관 주기 작업: 감사 로그·작업 기록 보관 기간(PRD 운영, SCR-ADM-06 동작. 0일이면 지우지 않는다),
// 만료된 관리 UI 세션, 24시간 넘게 "연결 중"으로 남은 OAuth 커넥터(SCR-EP-02)

const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionDays = { audit: number; activity: number };

export type PurgeResult = {
  audit: number;
  activity: number;
  sessions: number;
  pendingConnectors: number;
};

export async function purgeExpiredRecords(
  deps: { db: Db; now: () => Date },
  days: RetentionDays,
): Promise<PurgeResult> {
  const now = deps.now();
  const cutoff = (keepDays: number) => new Date(now.getTime() - keepDays * DAY_MS);
  return {
    audit: days.audit > 0 ? await deleteAuditLogsBefore(deps.db, cutoff(days.audit)) : 0,
    activity:
      days.activity > 0 ? await deleteActivityLogsBefore(deps.db, cutoff(days.activity)) : 0,
    sessions: await deleteExpiredSessions(deps.db, now),
    pendingConnectors: await deleteStalePendingConnectors(
      deps.db,
      new Date(now.getTime() - PENDING_TTL_MS),
    ),
  };
}

// 기동할 때와 하루 한 번 지운다. 로그에는 지운 건수만 남긴다. 돌려준 함수로 멈춘다
export function scheduleRetention(
  deps: {
    db: Db;
    now: () => Date;
    log: {
      info: (fields: Record<string, unknown>, message: string) => void;
      warn: (fields: Record<string, unknown>, message: string) => void;
    };
  },
  days: RetentionDays,
): () => void {
  const run = () => {
    purgeExpiredRecords(deps, days).then(
      (deleted) => deps.log.info({ deleted }, 'expired records purged'),
      (error: unknown) => deps.log.warn({ errName: (error as Error)?.name }, 'purge failed'),
    );
  };
  run();
  const timer = setInterval(run, DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
