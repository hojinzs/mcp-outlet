import { PageError } from '../components/page-error.tsx';

// 화면을 그리다 예외가 나면 원문 없이 서버 오류와 같은 안내만 보여준다 (SCR-COM-04)
export function RouteErrorPage() {
  return <PageError error={new Error('render failed')} onRetry={() => window.location.reload()} />;
}
