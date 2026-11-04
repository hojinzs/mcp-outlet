import { ApiError, NetworkError } from '../api/client.ts';

// 화면 전체를 불러오지 못했을 때의 종류 (SCR-COM-04). 401·403은 로그인·접근 거부 화면으로 보낸다
export type PageErrorKind = 'not_found' | 'server' | 'offline' | 'redirecting';

export function pageErrorKind(error: unknown): PageErrorKind {
  if (error instanceof NetworkError) return 'offline';
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return 'redirecting';
    if (error.status === 404) return 'not_found';
  }
  return 'server';
}

export const pageErrorText: Record<
  Exclude<PageErrorKind, 'redirecting'>,
  { title: string; description: string }
> = {
  not_found: { title: '찾을 수 없습니다', description: '주소가 바뀌었거나 삭제됐을 수 있습니다.' },
  server: {
    title: '화면을 불러오지 못했습니다',
    description: '잠시 후 다시 시도하세요. 계속되면 관리자에게 아래 요청 번호를 알려주세요.',
  },
  offline: {
    title: '서버에 연결할 수 없습니다',
    description: '인터넷 연결을 확인하고 다시 시도하세요.',
  },
};
