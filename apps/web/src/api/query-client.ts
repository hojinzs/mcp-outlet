import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { loginPagePath } from '../lib/login.ts';
import { ApiError } from './client.ts';

declare module '@tanstack/react-query' {
  interface Register {
    // false면 401에서 로그인 화면으로 보내지 않는다 (로그인 화면 자신의 세션 확인)
    queryMeta: { authRedirect?: boolean };
    mutationMeta: { authRedirect?: boolean };
  }
}

// 어떤 API든 401이면 지금 경로를 returnTo로 붙여 로그인 시작으로, 403이면 접근 거부로 (SCR-COM-01)
function handleAuthError(error: Error, meta: { authRedirect?: boolean } | undefined): void {
  if (meta?.authRedirect === false || !(error instanceof ApiError)) return;
  const current = `${window.location.pathname}${window.location.search}`;
  if (error.status === 401) window.location.assign(loginPagePath(current));
  if (error.status === 403) window.location.assign('/admin/forbidden?reason=admin_only');
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: (error, query) => handleAuthError(error, query.meta) }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _result, mutation) => handleAuthError(error, mutation.meta),
    }),
    defaultOptions: {
      queries: {
        // gateway가 답한 오류는 다시 시도해도 같다. 연결 끊김만 다시 시도한다
        retry: (count, error) => !(error instanceof ApiError) && count < 2,
        refetchOnWindowFocus: false,
      },
    },
  });
}
