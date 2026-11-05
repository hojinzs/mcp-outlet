import { useQuery } from '@tanstack/react-query';
import { ChevronDownIcon, MenuIcon, XIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { toast } from 'sonner';
import { authOptionsQuery, meQuery } from '../api/queries.ts';
import type { Me } from '../api/types.ts';
import { Loading } from '../components/loading.tsx';
import { PageError } from '../components/page-error.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Button } from '../components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.tsx';
import { logout } from '../lib/session.ts';
import { cn } from '../lib/utils.ts';

// SCR-COM-01 레이아웃. 아직 구현하지 않은 화면의 메뉴는 두지 않는다. 관리 메뉴는 admin에게만
type MenuItem = { to: string; label: string; matches: string[] };

const menu: MenuItem[] = [{ to: '/', label: '내 엔드포인트', matches: ['/', '/endpoints'] }];
const adminMenu: MenuItem[] = [
  { to: '/manage/users', label: '사용자', matches: ['/manage/users'] },
  { to: '/manage/audit', label: '감사 로그', matches: ['/manage/audit'] },
];

function isActive(pathname: string, matches: string[]): boolean {
  return matches.some((prefix) =>
    prefix === '/' ? pathname === '/' : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

async function runLogout(idp: boolean) {
  try {
    await logout({ idp });
  } catch {
    toast.error('로그아웃하지 못했습니다. 다시 시도하세요.');
  }
}

function AccountMenu({ me }: { me: Me }) {
  // IdP 로그아웃을 지원하지 않으면 같은 계정으로 다시 로그인되므로 숨긴다 (SCR-COM-03 결정 사항)
  const idpLogout = useQuery(authOptionsQuery).data?.idpLogout === true;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-64">
          <span className="truncate">{me.email ?? '내 계정'}</span>
          {me.role === 'admin' && <Badge variant="secondary">admin</Badge>}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="truncate text-muted-foreground">
          {me.email ?? '이메일 없음'}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => runLogout(false)}>로그아웃</DropdownMenuItem>
        {idpLogout && (
          <DropdownMenuItem onSelect={() => runLogout(true)}>다른 계정으로 로그인</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuGroup({
  title,
  items,
  onNavigate,
}: {
  title: string;
  items: MenuItem[];
  onNavigate?: (() => void) | undefined;
}) {
  const { pathname } = useLocation();
  return (
    <>
      <p className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground first:pt-0">{title}</p>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={cn(
            'rounded-md px-3 py-2 text-sm hover:bg-accent',
            isActive(pathname, item.matches) && 'bg-accent font-medium',
          )}
        >
          {item.label}
        </NavLink>
      ))}
    </>
  );
}

function Navigation({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  return (
    <nav aria-label="메뉴" className="flex flex-col gap-1">
      <MenuGroup title="내 작업" items={menu} onNavigate={onNavigate} />
      {me.role === 'admin' && <MenuGroup title="관리" items={adminMenu} onNavigate={onNavigate} />}
    </nav>
  );
}

// children이 있으면 Outlet 대신 그린다 (레이아웃 안에 보여주는 접근 거부 admin_only)
export function AppLayout({ children }: { children?: ReactNode }) {
  const me = useQuery(meQuery);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background px-4">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label={menuOpen ? '메뉴 닫기' : '메뉴 열기'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <XIcon /> : <MenuIcon />}
        </Button>
        <Link to="/" className="font-semibold">
          MCP Outlet
        </Link>
        <div className="ml-auto">{me.data && <AccountMenu me={me.data} />}</div>
      </header>
      <div className="mx-auto flex max-w-6xl">
        {/* 사용자 정보를 받기 전에는 메뉴 자리를 비워 둔다 */}
        <aside
          className={cn(
            'w-56 shrink-0 border-r bg-background p-3 md:static md:block md:min-h-[calc(100dvh-3.5rem)] md:w-56 md:border-b-0 md:bg-transparent',
            menuOpen ? 'fixed inset-x-0 top-14 z-30 block w-full border-b' : 'hidden',
          )}
        >
          {me.data && <Navigation me={me.data} onNavigate={() => setMenuOpen(false)} />}
        </aside>
        <main className="min-w-0 flex-1 p-4 md:p-8">
          {me.isPending ? (
            <Loading />
          ) : me.isError ? (
            <PageError error={me.error} onRetry={() => me.refetch()} retrying={me.isFetching} />
          ) : (
            (children ?? <Outlet />)
          )}
        </main>
      </div>
    </div>
  );
}
