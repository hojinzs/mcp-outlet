import { useQuery } from '@tanstack/react-query';
import { type ComponentProps, useId, useState } from 'react';
import {
  adminUserConnectorsQuery,
  adminUserEndpointsQuery,
  adminUsersQuery,
} from '../../api/queries.ts';
import type { CallResult } from '../../api/types.ts';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import {
  type AuditFilterState,
  type AuditPeriod,
  periodOptions,
  resultOptions,
  withUser,
} from '../../features/admin/audit-filter.ts';
import { userLabel } from '../../features/admin/users.ts';
import { cn } from '../../lib/utils.ts';

// SCR-ADM-06 필터. 엔드포인트·커넥터는 사용자를 고른 뒤 그 사람 것 중에서 고른다

function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function AuditFilters({
  value,
  onChange,
}: {
  value: AuditFilterState;
  onChange: (next: AuditFilterState) => void;
}) {
  const id = useId();
  const users = useQuery(adminUsersQuery);
  const endpoints = useQuery({ ...adminUserEndpointsQuery(value.userId), enabled: !!value.userId });
  const connectors = useQuery({
    ...adminUserConnectorsQuery(value.userId),
    enabled: !!value.userId,
  });
  // 툴 이름은 Enter나 포커스를 옮길 때 적용한다
  const [tool, setTool] = useState(value.tool);
  const [prevTool, setPrevTool] = useState(value.tool);
  if (value.tool !== prevTool) {
    setPrevTool(value.tool);
    setTool(value.tool);
  }
  const set = (patch: Partial<AuditFilterState>) => onChange({ ...value, ...patch });
  const applyTool = () => {
    if (tool.trim() !== value.tool) set({ tool: tool.trim() });
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-period`}>기간</Label>
        <Select
          id={`${id}-period`}
          value={value.period}
          onChange={(event) => set({ period: event.target.value as AuditPeriod })}
        >
          {periodOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        {value.period === 'custom' && (
          <div className="flex items-center gap-1">
            <Input
              type="datetime-local"
              aria-label="시작"
              value={value.from}
              onChange={(event) => set({ from: event.target.value })}
            />
            <span className="text-muted-foreground">~</span>
            <Input
              type="datetime-local"
              aria-label="끝"
              value={value.to}
              onChange={(event) => set({ to: event.target.value })}
            />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-user`}>사용자</Label>
        <Select
          id={`${id}-user`}
          value={value.userId}
          onChange={(event) => onChange(withUser(value, event.target.value))}
        >
          <option value="">전체</option>
          {users.data?.map((user) => (
            <option key={user.id} value={user.id}>
              {userLabel(user)}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-result`}>결과</Label>
        <Select
          id={`${id}-result`}
          value={value.result}
          onChange={(event) => set({ result: event.target.value as CallResult | '' })}
        >
          {resultOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-endpoint`}>엔드포인트</Label>
        <Select
          id={`${id}-endpoint`}
          value={value.endpointId}
          disabled={!value.userId}
          onChange={(event) => set({ endpointId: event.target.value })}
        >
          <option value="">{value.userId ? '전체' : '사용자를 먼저 고르세요'}</option>
          {endpoints.data?.map((endpoint) => (
            <option key={endpoint.id} value={endpoint.id}>
              {endpoint.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-connector`}>커넥터</Label>
        <Select
          id={`${id}-connector`}
          value={value.connectorId}
          disabled={!value.userId}
          onChange={(event) => set({ connectorId: event.target.value })}
        >
          <option value="">{value.userId ? '전체' : '사용자를 먼저 고르세요'}</option>
          {connectors.data?.map((connector) => (
            <option key={connector.id} value={connector.id}>
              {connector.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-tool`}>툴 이름</Label>
        <Input
          id={`${id}-tool`}
          type="search"
          placeholder="이름 일부"
          value={tool}
          onChange={(event) => setTool(event.target.value)}
          onBlur={applyTool}
          onKeyDown={(event) => {
            if (event.key === 'Enter') applyTool();
          }}
        />
      </div>
    </div>
  );
}
