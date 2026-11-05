import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { authOptionsQuery } from '../api/queries.ts';
import { Button } from '../components/ui/button.tsx';
import { Card } from '../components/ui/card.tsx';
import { AppLayout } from '../layouts/app-layout.tsx';
import { logout } from '../lib/session.ts';

// SCR-COM-03 접근 거부. 그룹 이름 목록은 보여주지 않는다
function NotMember({ email }: { email: string | null }) {
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const idpLogout = useQuery(authOptionsQuery).data?.idpLogout;

  // IdP 세션이 남아 있으면 같은 계정으로 다시 로그인되므로 IdP 로그아웃을 거친다
  async function switchAccount() {
    setPending(true);
    try {
      await logout({ idp: true });
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">사용 권한이 없습니다</h1>
        <p className="text-sm text-muted-foreground">
          {email ? `${email} 계정은 ` : '이 계정은 '}
          MCP Outlet 사용 그룹에 속해 있지 않습니다. 관리자에게 그룹 추가를 요청하세요.
        </p>
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            로그아웃하지 못했습니다. 다시 시도하세요.
          </p>
        )}
        {/* IdP가 로그아웃(end_session)을 지원하지 않으면 같은 계정으로 다시 로그인되므로 버튼 대신 안내한다 */}
        {idpLogout === true && (
          <Button onClick={switchAccount} disabled={pending} className="self-center">
            다른 계정으로 로그인
          </Button>
        )}
        {idpLogout === false && (
          <p className="text-sm text-muted-foreground">
            다른 계정으로 로그인하려면 로그인 서비스(IdP)에서 직접 로그아웃한 뒤 다시 로그인하세요.
          </p>
        )}
      </Card>
    </main>
  );
}

function AdminOnly() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <h1 className="text-xl font-semibold">관리자만 볼 수 있는 화면입니다</h1>
      <p className="text-sm text-muted-foreground">
        admin 역할이 필요하면 관리자에게 로그인 서비스(IdP)의 그룹 추가를 요청하세요.
      </p>
      <Button asChild>
        <Link to="/">홈으로</Link>
      </Button>
    </div>
  );
}

export function ForbiddenPage() {
  const [params] = useSearchParams();
  // not_member는 세션이 없으므로 레이아웃 밖에, admin_only는 세션이 있으므로 레이아웃 안에 그린다
  if (params.get('reason') === 'admin_only') {
    return (
      <AppLayout>
        <AdminOnly />
      </AppLayout>
    );
  }
  return <NotMember email={params.get('email')} />;
}
