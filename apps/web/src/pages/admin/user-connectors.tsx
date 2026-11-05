import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { adminUserConnectorsQuery, builtinsQuery } from '../../api/queries.ts';
import type { AdminConnector, Builtin } from '../../api/types.ts';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { adminConnectorStatus, userLabel } from '../../features/admin/users.ts';
import { builtinNameOf } from '../../features/connectors/builtin.ts';
import { connectorKindLabel } from '../../features/endpoints/connector-kind.ts';
import { formatDateTime } from '../../lib/format.ts';
import { ConnectorDisableDialog } from './connector-disable-dialog.tsx';

// SCR-ADM-04 사용자 펼치기: 그 사람의 커넥터. 자격증명·연결 계정·툴 허용목록은 보여주지 않는다

function ConnectorRow({
  connector,
  builtins,
}: {
  connector: AdminConnector;
  builtins: readonly Builtin[] | undefined;
}) {
  const [open, setOpen] = useState(false);
  const status = adminConnectorStatus(connector);
  const { disabled } = connector;
  const kind = connectorKindLabel(connector.runtime, builtinNameOf(builtins, connector.builtin));
  return (
    <tr className="border-t align-top">
      <td className="px-3 py-2 font-medium">
        <span className="block max-w-48 truncate" title={connector.name}>
          {connector.name}
        </span>
      </td>
      {/* 내장 서비스 이름이 길어 표가 가로로 넘치지 않게 줄이고 전체 이름은 title로 */}
      <td className="px-3 py-2">
        <span className="block max-w-32 truncate" title={kind}>
          {kind}
        </span>
      </td>
      <td className="px-3 py-2">
        {connector.url ? (
          <code className="block max-w-56 truncate font-mono text-xs" title={connector.url}>
            {connector.url}
          </code>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
      <td className="px-3 py-2">
        <Badge variant={status.variant}>{status.label}</Badge>
      </td>
      <td className="px-3 py-2 text-right">{connector.endpointCount}</td>
      <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(connector.lastCalledAt)}</td>
      <td className="px-3 py-2">
        {disabled ? (
          <div className="flex max-w-56 flex-col gap-1">
            <p className="text-xs break-words">사유: {disabled.reason ?? '-'}</p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(disabled.at)} ·{' '}
              {disabled.by ? userLabel(disabled.by) : '지워진 관리자'}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => setOpen(true)}
            >
              다시 사용
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            사용 중지
          </Button>
        )}
        <ConnectorDisableDialog connector={connector} open={open} onOpenChange={setOpen} />
      </td>
    </tr>
  );
}

export function UserConnectors({ userId }: { userId: string }) {
  const connectors = useQuery(adminUserConnectorsQuery(userId));
  const hasBuiltin = connectors.data?.some((connector) => connector.builtin !== null);
  const builtins = useQuery({ ...builtinsQuery, enabled: hasBuiltin === true });

  if (connectors.isPending) {
    return <p className="p-3 text-sm text-muted-foreground">불러오는 중</p>;
  }
  if (connectors.isError) {
    return <p className="p-3 text-sm text-destructive">커넥터 목록을 불러오지 못했습니다.</p>;
  }
  if (connectors.data.length === 0) {
    return <p className="p-3 text-sm text-muted-foreground">등록한 커넥터가 없습니다.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border bg-background">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">이름</th>
            <th className="px-3 py-2 font-medium">종류</th>
            <th className="px-3 py-2 font-medium">원격 URL</th>
            <th className="px-3 py-2 font-medium">상태</th>
            <th className="px-3 py-2 text-right font-medium">엔드포인트</th>
            <th className="px-3 py-2 font-medium">최근 호출</th>
            <th className="px-3 py-2 font-medium">사용 중지</th>
          </tr>
        </thead>
        <tbody>
          {connectors.data.map((connector) => (
            <ConnectorRow key={connector.id} connector={connector} builtins={builtins.data} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
