import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { adminAuditQuery, adminAuditSummaryQuery } from '../../api/queries.ts';
import type { AuditEntry, AuditSummary } from '../../api/types.ts';
import { CallResultBadge } from '../../components/call-result-badge.tsx';
import { Loading } from '../../components/loading.tsx';
import { PageError } from '../../components/page-error.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card } from '../../components/ui/card.tsx';
import {
  type AuditFilterState,
  auditApiQuery,
  errorRate,
  readAuditFilter,
  retentionNotice,
  SLOW_CALL_MS,
  withUser,
  writeAuditFilter,
} from '../../features/admin/audit-filter.ts';
import { userLabel } from '../../features/admin/users.ts';
import { formatCallTime } from '../../lib/format.ts';
import { cn } from '../../lib/utils.ts';
import { AuditFilters } from './audit-filters.tsx';

// SCR-ADM-06 감사 로그. 인자·응답 본문은 저장하지 않으므로 행을 눌러도 상세가 없다 (F-UI-03)

const formatMs = (value: number | null) => (value === null ? '-' : `${value.toLocaleString()} ms`);

function SummaryLine({ summary }: { summary: AuditSummary }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border bg-background px-4 py-3 text-sm">
      <div className="flex gap-2">
        <dt className="text-muted-foreground">호출</dt>
        <dd className="font-medium">{summary.total.toLocaleString()}</dd>
      </div>
      <div className="flex gap-2">
        <dt className="text-muted-foreground">오류</dt>
        <dd className={cn('font-medium', summary.errors > 0 && 'text-warning')}>
          {summary.errors.toLocaleString()} ({errorRate(summary.errors, summary.total)})
        </dd>
      </div>
      <div className="flex gap-2">
        <dt className="text-muted-foreground">거부</dt>
        <dd className="font-medium">{summary.denied.toLocaleString()}</dd>
      </div>
      <div className="flex gap-2">
        <dt className="text-muted-foreground">소요시간</dt>
        <dd className="font-medium">
          중앙값 {formatMs(summary.durationMs.p50)} · p95 {formatMs(summary.durationMs.p95)}
        </dd>
      </div>
    </dl>
  );
}

function EntryRow({
  entry,
  onFilter,
}: {
  entry: AuditEntry;
  onFilter: (patch: (state: AuditFilterState) => AuditFilterState) => void;
}) {
  const { user, endpoint, connector } = entry;
  return (
    <tr className="border-t">
      <td className="px-3 py-2 whitespace-nowrap">{formatCallTime(entry.at)}</td>
      <td className="px-3 py-2">
        {user ? (
          <button
            type="button"
            className="text-left break-all hover:underline"
            onClick={() => onFilter((state) => withUser(state, user.id))}
          >
            {userLabel(user)}
          </button>
        ) : (
          <span className="text-muted-foreground">삭제된 사용자</span>
        )}
      </td>
      <td className="px-3 py-2">
        {endpoint && user ? (
          <button
            type="button"
            className="text-left hover:underline"
            onClick={() =>
              onFilter((state) => ({ ...withUser(state, user.id), endpointId: endpoint.id }))
            }
          >
            {endpoint.name}
          </button>
        ) : endpoint ? (
          endpoint.name
        ) : (
          <span className="text-muted-foreground">삭제된 엔드포인트</span>
        )}
      </td>
      <td className="px-3 py-2">
        {connector ? connector.name : <span className="text-muted-foreground">삭제된 커넥터</span>}
      </td>
      <td className="px-3 py-2">
        <code className="font-mono text-xs whitespace-nowrap">{entry.toolName}</code>
      </td>
      <td className="px-3 py-2">
        <CallResultBadge result={entry.result} />
      </td>
      <td
        className={cn(
          'px-3 py-2 text-right whitespace-nowrap',
          entry.durationMs >= SLOW_CALL_MS && 'font-semibold text-warning',
        )}
      >
        {formatMs(entry.durationMs)}
      </td>
    </tr>
  );
}

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const filter = readAuditFilter(params);
  const query = auditApiQuery(filter, new Date());
  const entries = useInfiniteQuery(adminAuditQuery(query));
  const summary = useQuery(adminAuditSummaryQuery(query));

  const change = (next: AuditFilterState) => setParams(writeAuditFilter(next));
  const applyPatch = (patch: (state: AuditFilterState) => AuditFilterState) =>
    change(patch(filter));

  const rows = entries.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">감사 로그</h1>
      <AuditFilters value={filter} onChange={change} />
      {summary.data && <SummaryLine summary={summary.data} />}
      {entries.isPending ? (
        <Loading />
      ) : entries.isError ? (
        <PageError
          error={entries.error}
          onRetry={() => entries.refetch()}
          retrying={entries.isFetching}
        />
      ) : rows.length === 0 ? (
        <Card className="items-center py-10 text-sm text-muted-foreground">
          조건에 맞는 호출이 없습니다.
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">시각</th>
                <th className="px-3 py-2 font-medium">사용자</th>
                <th className="px-3 py-2 font-medium">엔드포인트</th>
                <th className="px-3 py-2 font-medium">커넥터</th>
                <th className="px-3 py-2 font-medium">툴 이름</th>
                <th className="px-3 py-2 font-medium">결과</th>
                <th className="px-3 py-2 text-right font-medium">소요시간</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <EntryRow key={entry.id} entry={entry} onFilter={applyPatch} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {entries.hasNextPage && (
        <Button
          variant="outline"
          className="self-center"
          onClick={() => entries.fetchNextPage()}
          disabled={entries.isFetchingNextPage}
        >
          {entries.isFetchingNextPage ? '불러오는 중' : '더 보기'}
        </Button>
      )}
      {summary.data && (
        <p className="text-xs text-muted-foreground">
          인자와 응답 본문은 기록하지 않습니다. {retentionNotice(summary.data.retentionDays)}
        </p>
      )}
    </div>
  );
}
