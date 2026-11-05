import { useQuery } from '@tanstack/react-query';
import { PlusIcon, TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { builtinsQuery, connectorsQuery, endpointsQuery } from '../api/queries.ts';
import type { Builtin, Connector, ConnectorAuthView, EndpointSummary } from '../api/types.ts';
import { ConnectorStatusBadge } from '../components/connector-status-badge.tsx';
import { CopyButton } from '../components/copy-button.tsx';
import { DeleteConnectorDialog } from '../components/delete-connector-dialog.tsx';
import { Loading } from '../components/loading.tsx';
import { PageError } from '../components/page-error.tsx';
import { StatusBadge } from '../components/status-badge.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card } from '../components/ui/card.tsx';
import { builtinNameOf, unpickableGuide } from '../features/connectors/builtin.ts';
import { orphanConnectors } from '../features/connectors/deletion.ts';
import { connectorKindLabel } from '../features/endpoints/connector-kind.ts';
import {
  endpointStatusHint,
  type ReauthBanner,
  reauthBanners,
} from '../features/endpoints/status.ts';
import { HomeConnectNotice } from './home-connect-notice.tsx';

// SCR-EP-01 엔드포인트 목록 (홈). 정렬은 gateway가 최근 수정순으로 준다.
// 상태 토글과 삭제는 실수를 막기 위해 상세 화면에서만 한다

function EmptyState() {
  return (
    <Card className="items-center gap-3 py-12 text-center">
      <h2 className="text-lg font-semibold">아직 엔드포인트가 없습니다</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        쓰고 있는 MCP 서버 주소나 Google Analytics 같은 서비스를 등록하고, AI에 보여줄 툴만 골라
        주소를 받으세요.
      </p>
      <Button asChild>
        <Link to="/endpoints/new">첫 엔드포인트 추가</Link>
      </Button>
    </Card>
  );
}

function Banner({ banner }: { banner: ReauthBanner }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm"
    >
      <TriangleAlertIcon className="size-4 text-warning" />
      {banner.fix === 'replace_key' ? (
        <p className="flex-1">
          {banner.connectorName}의 서비스 계정 키가 거부되어 엔드포인트 {banner.endpointCount}개가
          동작하지 않습니다. 키 파일을 교체하세요.
        </p>
      ) : (
        <p className="flex-1">
          {banner.connectorName} 연결이 끊겨 엔드포인트 {banner.endpointCount}개가 동작하지
          않습니다. 다시 연결하세요.
        </p>
      )}
      <Button size="sm" variant="outline" asChild>
        <Link to={`/endpoints/${banner.firstEndpointId}`}>
          {banner.fix === 'replace_key' ? '키 파일 교체' : '다시 연결'}
        </Link>
      </Button>
    </div>
  );
}

function EndpointRow({
  endpoint,
  builtins,
  authType,
}: {
  endpoint: EndpointSummary;
  builtins: readonly Builtin[] | undefined;
  // 커넥터 목록을 받기 전이면 undefined. 상태 안내를 인증 방식에 맞춘다
  authType: ConnectorAuthView['type'] | undefined;
}) {
  const { toolCounts } = endpoint;
  return (
    <tr className="border-t align-middle">
      <td className="px-4 py-3">
        <Link to={`/endpoints/${endpoint.id}`} className="font-medium hover:underline">
          {endpoint.name}
        </Link>
      </td>
      <td className="px-4 py-3">
        <div>{endpoint.connector.name}</div>
        <div className="text-xs text-muted-foreground">
          {connectorKindLabel(
            endpoint.connector.runtime,
            builtinNameOf(builtins, endpoint.connector.builtin),
          )}
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        {toolCounts.allowed} / {toolCounts.total}
        {toolCounts.new > 0 && (
          <Badge variant="warning" className="ml-2">
            새 툴 {toolCounts.new}
          </Badge>
        )}
      </td>
      <td className="px-4 py-3">
        <StatusBadge
          status={endpoint.status}
          hint={endpointStatusHint(endpoint.status, authType)}
        />
        {/* 관리자가 적은 사용 중지 사유 (SCR-ADM-04 사용 중지) */}
        {endpoint.status === 'disabled' && endpoint.connector.disabledReason && (
          <p className="mt-1 max-w-48 text-xs text-muted-foreground">
            사유: {endpoint.connector.disabledReason}
          </p>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <code className="max-w-56 truncate font-mono text-xs" title={endpoint.url}>
            {endpoint.url}
          </code>
          <CopyButton value={endpoint.url} label="엔드포인트 URL 복사" />
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <Button size="sm" variant="outline" asChild>
          <Link to={`/endpoints/${endpoint.id}/connect`}>연결 안내</Link>
        </Button>
      </td>
    </tr>
  );
}

// 엔드포인트를 지울 때 커넥터를 남겨 두면 사용자당 커넥터 상한을 차지한다.
// 다시 쓰거나 지울 수 있게 따로 보여준다 (F-CON-04, SCR-EP-01 결정 사항)
function OrphanConnectors({
  connectors,
  builtins,
}: {
  connectors: readonly Connector[];
  builtins: readonly Builtin[] | undefined;
}) {
  const [deleting, setDeleting] = useState<Connector | null>(null);
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">엔드포인트 없는 커넥터</h2>
        <p className="text-sm text-muted-foreground">
          정상인 커넥터는 엔드포인트 추가의 "내 커넥터에서 고르기"로 다시 쓸 수 있고, 정상이 아닌
          커넥터는 "다시 연결·연결 테스트"로 고친 뒤 씁니다. 쓰지 않으면 지우세요. 커넥터 수에도
          상한이 있습니다.
        </p>
      </div>
      <ul className="divide-y rounded-lg border bg-background text-sm">
        {connectors.map((connector) => {
          // 정상이 아니면 엔드포인트 추가의 이어하기 화면에서 다시 연결·연결 테스트한다
          const link = unpickableGuide(connector, undefined)?.link;
          return (
            <li key={connector.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate">{connector.name}</div>
                <div className="text-xs text-muted-foreground">
                  {connectorKindLabel(
                    connector.runtime,
                    builtinNameOf(builtins, connector.builtin),
                  )}
                </div>
              </div>
              <ConnectorStatusBadge connector={connector} />
              {link && (
                <Button size="sm" variant="outline" asChild>
                  <Link to={link.to}>{link.label}</Link>
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                onClick={() => setDeleting(connector)}
              >
                삭제
              </Button>
            </li>
          );
        })}
      </ul>
      {deleting && (
        <DeleteConnectorDialog
          connector={deleting}
          endpoints={[]}
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
        />
      )}
    </section>
  );
}

export function EndpointListPage() {
  const endpoints = useQuery(endpointsQuery);
  const connectors = useQuery(connectorsQuery);
  const orphans = orphanConnectors(connectors.data);
  // /api/endpoints는 커넥터 인증 방식을 주지 않아 커넥터 목록에서 찾는다
  const authTypes = new Map(
    connectors.data?.map((connector) => [connector.id, connector.auth.type]) ?? [],
  );
  const serviceAccountIds = new Set(
    [...authTypes].filter(([, type]) => type === 'service_account').map(([id]) => id),
  );
  const hasBuiltin =
    endpoints.data?.some((endpoint) => endpoint.connector.builtin !== null) ||
    orphans.some((connector) => connector.builtin !== null);
  // 내장 서비스 이름을 못 받으면 "내장 서비스"로 둔다
  const builtins = useQuery({ ...builtinsQuery, enabled: hasBuiltin === true });

  if (endpoints.isPending) return <Loading />;
  if (endpoints.isError) {
    return (
      <PageError
        error={endpoints.error}
        onRetry={() => endpoints.refetch()}
        retrying={endpoints.isFetching}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">내 엔드포인트</h1>
        <Button asChild>
          <Link to="/endpoints/new">
            <PlusIcon />
            엔드포인트 추가
          </Link>
        </Button>
      </div>
      <HomeConnectNotice />
      {reauthBanners(endpoints.data, serviceAccountIds).map((banner) => (
        <Banner key={banner.connectorId} banner={banner} />
      ))}
      {endpoints.data.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">이름</th>
                <th className="px-4 py-2 font-medium">커넥터</th>
                <th className="px-4 py-2 font-medium">노출 툴</th>
                <th className="px-4 py-2 font-medium">상태</th>
                <th className="px-4 py-2 font-medium">엔드포인트 URL</th>
                <th className="px-4 py-2 font-medium">
                  <span className="sr-only">작업</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {endpoints.data.map((endpoint) => (
                <EndpointRow
                  key={endpoint.id}
                  endpoint={endpoint}
                  builtins={builtins.data}
                  authType={authTypes.get(endpoint.connector.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {orphans.length > 0 && <OrphanConnectors connectors={orphans} builtins={builtins.data} />}
    </div>
  );
}
