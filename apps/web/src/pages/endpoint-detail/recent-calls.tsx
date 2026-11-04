import { useQuery } from '@tanstack/react-query';
import { RefreshCwIcon } from 'lucide-react';
import { Link } from 'react-router';
import { callsQuery } from '../../api/queries.ts';
import type { CallResult, EndpointDetail } from '../../api/types.ts';
import { Badge, type BadgeVariant } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardTitle } from '../../components/ui/card.tsx';
import { canAllowFromCall } from '../../features/endpoints/detail.ts';
import { formatCallTime } from '../../lib/format.ts';

const resultView: Record<CallResult, { label: string; variant: BadgeVariant }> = {
  ok: { label: '성공', variant: 'success' },
  error: { label: '오류', variant: 'destructive' },
  denied: { label: '거부', variant: 'warning' },
};

// SCR-EP-03 최근 호출 20건. 감사 로그에서 본인 엔드포인트 것만
export function RecentCalls({
  endpoint,
  selected,
  onAllow,
}: {
  endpoint: EndpointDetail;
  selected: ReadonlySet<string>;
  onAllow: (toolName: string) => void;
}) {
  const calls = useQuery(callsQuery(endpoint.id));

  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>최근 호출</CardTitle>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="최근 호출 새로고침"
          onClick={() => calls.refetch()}
          disabled={calls.isFetching}
        >
          <RefreshCwIcon />
        </Button>
      </div>
      {calls.isPending ? (
        <p className="text-sm text-muted-foreground">불러오는 중</p>
      ) : calls.isError ? (
        <p className="text-sm text-destructive">최근 호출을 불러오지 못했습니다.</p>
      ) : calls.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          아직 호출이 없습니다.{' '}
          <Link to={`/endpoints/${endpoint.id}/connect`} className="underline">
            연결 안내
          </Link>
          를 보고 AI 클라이언트에 등록하세요.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-4 font-medium">시각</th>
                <th className="py-2 pr-4 font-medium">툴 이름</th>
                <th className="py-2 pr-4 font-medium">결과</th>
                <th className="py-2 pr-4 text-right font-medium">소요시간</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">작업</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {calls.data.map((call, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 호출 기록에는 화면용 id가 없다
                <tr key={`${call.at}-${index}`} className="border-t">
                  <td className="py-2 pr-4 whitespace-nowrap">{formatCallTime(call.at)}</td>
                  <td className="py-2 pr-4">
                    <code className="font-mono">{call.toolName}</code>
                  </td>
                  <td className="py-2 pr-4">
                    <Badge variant={resultView[call.result].variant}>
                      {resultView[call.result].label}
                    </Badge>
                  </td>
                  <td className="py-2 pr-4 text-right whitespace-nowrap">{call.durationMs} ms</td>
                  <td className="py-2 text-right">
                    {canAllowFromCall(call, endpoint, selected) && (
                      <Button size="sm" variant="outline" onClick={() => onAllow(call.toolName)}>
                        허용목록에 추가
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
