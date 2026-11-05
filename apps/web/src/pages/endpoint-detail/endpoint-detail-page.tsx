import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { builtinsQuery, endpointQuery } from '../../api/queries.ts';
import type { EndpointDetail } from '../../api/types.ts';
import { CopyButton } from '../../components/copy-button.tsx';
import { LeaveGuard } from '../../components/leave-guard.tsx';
import { Loading } from '../../components/loading.tsx';
import { PageError } from '../../components/page-error.tsx';
import { StatusBadge } from '../../components/status-badge.tsx';
import { ToolSelector } from '../../components/tool-selector.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardDescription, CardTitle } from '../../components/ui/card.tsx';
import { Switch } from '../../components/ui/switch.tsx';
import { builtinNameOf } from '../../features/connectors/builtin.ts';
import { connectorKindLabel } from '../../features/endpoints/connector-kind.ts';
import { newToolNames, savedSelection } from '../../features/endpoints/detail.ts';
import { endpointStatusView } from '../../features/endpoints/status.ts';
import { sameSelection, toggle } from '../../features/tools/selection.ts';
import { formatDateTime } from '../../lib/format.ts';
import { ConnectorSettings } from './connector-settings.tsx';
import { DeleteEndpoint } from './delete-endpoint.tsx';
import { EndpointName } from './endpoint-name.tsx';
import { RecentCalls } from './recent-calls.tsx';
import { useEndpointUpdate } from './use-endpoint-update.ts';

// SCR-EP-03 엔드포인트 상세. 다른 사람의 엔드포인트도 gateway가 404로 답한다 (F-AUTH-05)

function ExposedTools({
  endpoint,
  draft,
  onDraftChange,
}: {
  endpoint: EndpointDetail;
  draft: Set<string> | null;
  onDraftChange: (next: Set<string> | null) => void;
}) {
  const update = useEndpointUpdate(endpoint.id);
  const saved = savedSelection(endpoint);
  const selected = draft ?? saved;
  const dirty = draft !== null && !sameSelection(draft, saved);
  const newTools = newToolNames(endpoint);

  function save() {
    update.mutate(
      { allowedTools: [...selected] },
      {
        onSuccess: () => {
          onDraftChange(null);
          toast.success('노출 툴을 저장했습니다');
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  // 새 툴을 허용하지 않고 배지만 없앤다. 허용목록은 그대로 두고 knownTools만 갱신한다
  function acknowledge() {
    update.mutate(
      { acknowledgeNewTools: true },
      { onError: (error) => toast.error(error.message) },
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <CardTitle>노출 툴</CardTitle>
          <CardDescription>저장 전에는 호출에 반영되지 않습니다.</CardDescription>
        </div>
        {newTools.size > 0 && (
          <Button variant="outline" size="sm" onClick={acknowledge} disabled={update.isPending}>
            새 툴 확인함
          </Button>
        )}
      </div>
      <ToolSelector
        tools={endpoint.tools}
        selected={selected}
        onChange={onDraftChange}
        newTools={newTools}
        missingTools={endpoint.missingTools}
      />
      {selected.size === 0 && (
        <p className="text-sm text-warning">
          허용 툴을 0개로 저장할 수 없습니다. 모두 막고 싶으면 아래에서 비활성으로 바꾸세요.
        </p>
      )}
      <div className="flex gap-2 border-t pt-4">
        <Button onClick={save} disabled={!dirty || selected.size === 0 || update.isPending}>
          저장
        </Button>
        <Button variant="ghost" onClick={() => onDraftChange(null)} disabled={!dirty}>
          되돌리기
        </Button>
      </div>
    </Card>
  );
}

function EnabledSwitch({ endpoint }: { endpoint: EndpointDetail }) {
  const update = useEndpointUpdate(endpoint.id);
  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle id="endpoint-enabled">활성</CardTitle>
          <CardDescription>
            끄면 이 URL로 오는 요청을 거부합니다. AI 클라이언트의 연결 설정은 그대로 둡니다.
          </CardDescription>
        </div>
        {/* 바꾸면 바로 저장한다. 다음 MCP 요청부터 반영된다 (F-EP-04) */}
        <Switch
          aria-labelledby="endpoint-enabled"
          checked={endpoint.enabled}
          disabled={update.isPending}
          onCheckedChange={(enabled) =>
            update.mutate(
              { enabled },
              {
                onSuccess: () =>
                  toast.success(enabled ? '엔드포인트를 켰습니다' : '엔드포인트를 껐습니다'),
                onError: (error) => toast.error(error.message),
              },
            )
          }
        />
      </div>
    </Card>
  );
}

export function EndpointDetailPage() {
  const { id = '' } = useParams();
  const endpoint = useQuery(endpointQuery(id));
  // 내장 서비스면 종류 칸에 서비스 이름을 보여준다
  const builtins = useQuery({ ...builtinsQuery, enabled: !!endpoint.data?.connector.builtin });
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [leaving, setLeaving] = useState(false);

  if (endpoint.isPending) return <Loading />;
  if (endpoint.isError) {
    return (
      <PageError
        error={endpoint.error}
        onRetry={() => endpoint.refetch()}
        retrying={endpoint.isFetching}
      />
    );
  }

  const data = endpoint.data;
  const saved = savedSelection(data);
  const selected = draft ?? saved;
  const dirty = draft !== null && !sameSelection(draft, saved);
  const hint = endpointStatusView[data.status].hint;

  return (
    <div className="flex flex-col gap-6">
      <LeaveGuard when={dirty && !leaving} message="저장하지 않은 노출 툴 변경이 사라집니다." />
      <div className="flex flex-col gap-3">
        <Link to="/" className="text-sm text-muted-foreground hover:underline">
          ← 내 엔드포인트
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <EndpointName key={data.name} id={data.id} name={data.name} />
          <StatusBadge status={data.status} />
          <Button asChild className="ml-auto">
            <Link to={`/endpoints/${data.id}/connect`}>연결 안내</Link>
          </Button>
        </div>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
        {data.status === 'disabled' && data.connector.disabledReason && (
          <p className="text-sm text-muted-foreground">
            사용 중지 사유: {data.connector.disabledReason}
          </p>
        )}
      </div>

      <Card>
        <CardTitle>기본 정보</CardTitle>
        <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
          <dt className="text-muted-foreground">엔드포인트 URL</dt>
          <dd className="flex min-w-0 items-center gap-2">
            <code className="truncate font-mono">{data.url}</code>
            <CopyButton value={data.url} label="엔드포인트 URL 복사" />
          </dd>
          <dt className="text-muted-foreground">커넥터</dt>
          <dd>
            {data.connector.name}{' '}
            <span className="text-muted-foreground">
              ·{' '}
              {connectorKindLabel(
                data.connector.runtime,
                builtinNameOf(builtins.data, data.connector.builtin),
              )}
            </span>
          </dd>
          <dt className="text-muted-foreground">만든 날</dt>
          <dd>{formatDateTime(data.createdAt)}</dd>
        </dl>
      </Card>

      <ConnectorSettings
        endpointId={data.id}
        connectorId={data.connector.id}
        endpointCount={data.connectorEndpointCount}
        onDeleting={() => flushSync(() => setLeaving(true))}
      />
      <ExposedTools endpoint={data} draft={draft} onDraftChange={setDraft} />
      <EnabledSwitch endpoint={data} />
      {/* "허용목록에 추가"는 체크만 바꾼다. 저장해야 반영된다 */}
      <RecentCalls
        endpoint={data}
        selected={selected}
        onAllow={(name) => setDraft(toggle(selected, name, true))}
      />
      <DeleteEndpoint
        id={data.id}
        isLastOfConnector={data.connectorEndpointCount === 1}
        onDeleting={() => flushSync(() => setLeaving(true))}
      />
    </div>
  );
}
