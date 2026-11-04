import { useQuery } from '@tanstack/react-query';
import { Navigate, useSearchParams } from 'react-router';
import { meQuery } from '../api/queries.ts';
import { Loading } from '../components/loading.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card } from '../components/ui/card.tsx';
import { HOME_PATH, loginErrorMessage, loginStartUrl, safeReturnTo } from '../lib/login.ts';

// router basename(/admin)을 뺀 경로로 바꾼다
function routerPath(path: string): string {
  return path.slice('/admin'.length) || '/';
}

// SCR-COM-02 로그인 시작. 실패가 반복될 때 IdP와 무한히 오가지 않도록 자동으로 넘기지 않는다
export function LoginPage() {
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const error = loginErrorMessage(params.get('error'));
  const me = useQuery({ ...meQuery, meta: { authRedirect: false }, retry: false });

  if (me.isPending) return <Loading />;
  // 이미 세션이 있으면 이 화면을 보여주지 않는다
  if (me.data) return <Navigate to={routerPath(returnTo ?? HOME_PATH)} replace />;

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm items-center gap-6 p-8 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">MCP Outlet</h1>
          <p className="text-sm text-muted-foreground">
            내 MCP 서버와 서비스를 골라 AI 에이전트에 안전하게 연결합니다.
          </p>
        </div>
        {error && (
          <p
            role="alert"
            className="w-full rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {/* IdP 이름은 넣지 않는다 (F-AUTH-01) */}
        <Button asChild size="lg" className="w-full">
          <a href={loginStartUrl(returnTo)}>로그인</a>
        </Button>
      </Card>
    </main>
  );
}
