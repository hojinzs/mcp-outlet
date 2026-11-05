import type { Db } from '../db/client.ts';
import { deleteActivityLogsBefore } from '../db/queries/activity-logs.ts';
import { deleteAuditLogsBefore } from '../db/queries/audit-logs.ts';

// 감사 로그·작업 기록 보관 기간 (PRD 운영, SCR-ADM-06 동작). 0일이면 지우지 않는다

const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionDays = { audit: number; activity: number };

export async function purgeExpiredLogs(
  deps: { db: Db; now: () => Date },
  days: RetentionDays,
): Promise<{ audit: number; activity: number }> {
  const cutoff = (keepDays: number) => new Date(deps.now().getTime() - keepDays * DAY_MS);
  return {
    audit: days.audit > 0 ? await deleteAuditLogsBefore(deps.db, cutoff(days.audit)) : 0,
    activity:
      days.activity > 0 ? await deleteActivityLogsBefore(deps.db, cutoff(days.activity)) : 0,
  };
}

// 기동할 때와 하루 한 번 지운다. 로그에는 지운 건수만 남긴다. 돌려준 함수로 멈춘다
export function scheduleLogRetention(
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
    purgeExpiredLogs(deps, days).then(
      (deleted) => deps.log.info({ deleted }, 'expired logs purged'),
      (error: unknown) => deps.log.warn({ errName: (error as Error)?.name }, 'log purge failed'),
    );
  };
  run();
  const timer = setInterval(run, DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
