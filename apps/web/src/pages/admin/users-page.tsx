import { useQuery } from '@tanstack/react-query';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { Fragment, useState } from 'react';
import { adminUsersQuery } from '../../api/queries.ts';
import type { AdminUser } from '../../api/types.ts';
import { Loading } from '../../components/loading.tsx';
import { PageError } from '../../components/page-error.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card } from '../../components/ui/card.tsx';
import { Input } from '../../components/ui/input.tsx';
import { filterUsers, type UserFilter, userLabel } from '../../features/admin/users.ts';
import { formatDateTime } from '../../lib/format.ts';
import { cn } from '../../lib/utils.ts';
import { UserConnectors } from './user-connectors.tsx';

// SCR-ADM-04 사용자 목록. 정렬(최근 호출순, 없으면 마지막 로그인순)은 gateway가 한다.
// 역할·그룹은 IdP가 정하므로 읽기 전용이다

const COLUMN_COUNT = 8;

function UserRow({
  user,
  expanded,
  onToggle,
}: {
  user: AdminUser;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Fragment>
      <tr className="cursor-pointer border-t align-middle hover:bg-accent/50" onClick={onToggle}>
        <td className="w-8 px-2 py-3">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={expanded}
            aria-label={`${userLabel(user)} 커넥터 ${expanded ? '접기' : '펼치기'}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
          >
            {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </Button>
        </td>
        <td className="px-3 py-3 font-medium break-all">{userLabel(user)}</td>
        <td className="px-3 py-3">
          <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>{user.role}</Badge>
        </td>
        <td className="px-3 py-3">
          <div className="flex max-w-56 flex-wrap gap-1">
            {user.groups.length === 0 ? (
              <span className="text-muted-foreground">-</span>
            ) : (
              user.groups.map((group) => (
                <Badge key={group} variant="outline">
                  {group}
                </Badge>
              ))
            )}
          </div>
        </td>
        <td className="px-3 py-3 whitespace-nowrap">{formatDateTime(user.lastLoginAt)}</td>
        <td className="px-3 py-3 whitespace-nowrap">
          {user.connectorCount}
          {user.disabledConnectorCount > 0 && (
            <Badge variant="destructive" className="ml-2">
              중지 {user.disabledConnectorCount}
            </Badge>
          )}
        </td>
        <td className="px-3 py-3">{user.endpointCount}</td>
        <td className="px-3 py-3 whitespace-nowrap">{formatDateTime(user.lastCalledAt)}</td>
      </tr>
      {expanded && (
        <tr className="bg-muted/40">
          {/* max-w-0: 안쪽 커넥터 표가 바깥 표 폭을 늘리지 않고 자기 상자 안에서만 가로로 넘친다 */}
          <td colSpan={COLUMN_COUNT} className="max-w-0 px-3 py-3">
            <UserConnectors userId={user.id} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export function UsersPage() {
  const users = useQuery(adminUsersQuery);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<UserFilter>('all');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  if (users.isPending) return <Loading />;
  if (users.isError) {
    return (
      <PageError error={users.error} onRetry={() => users.refetch()} retrying={users.isFetching} />
    );
  }

  const visible = filterUsers(users.data, search, filter);
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">사용자</h1>
        <p className="text-sm text-muted-foreground">
          역할과 그룹은 로그인 서비스(IdP)의 그룹으로 정해지며 여기서 바꿀 수 없습니다. 사용자를
          막으려면 로그인 서비스(IdP)에서 그룹을 빼세요.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          aria-label="이메일로 거르기"
          placeholder="이메일로 거르기"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-xs"
        />
        <fieldset className="flex rounded-md border p-0.5">
          <legend className="sr-only">사용자 필터</legend>
          {(
            [
              ['all', '전체'],
              ['disabled', '사용 중지한 커넥터가 있는 사용자'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                'rounded px-3 py-1 text-sm',
                filter === value ? 'bg-accent font-medium' : 'text-muted-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </fieldset>
      </div>
      {visible.length === 0 ? (
        <Card className="items-center py-10 text-sm text-muted-foreground">
          {users.data.length === 0 ? '아직 로그인한 사용자가 없습니다.' : '맞는 사용자가 없습니다.'}
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-2">
                  <span className="sr-only">펼치기</span>
                </th>
                <th className="px-3 py-2 font-medium">이메일</th>
                <th className="px-3 py-2 font-medium">역할</th>
                <th className="px-3 py-2 font-medium">그룹</th>
                <th className="px-3 py-2 font-medium">마지막 로그인</th>
                <th className="px-3 py-2 font-medium">커넥터</th>
                <th className="px-3 py-2 font-medium">엔드포인트</th>
                <th className="px-3 py-2 font-medium">최근 호출</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  expanded={expanded.has(user.id)}
                  onToggle={() => toggle(user.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
