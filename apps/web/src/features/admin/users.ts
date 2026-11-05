import type { AdminConnector, AdminUser } from '../../api/types.ts';
import type { BadgeVariant } from '../../components/ui/badge.tsx';

// SCR-ADM-04 사용자 목록 규칙

// 이메일이 없으면 sub 앞부분
export function userLabel(user: { email: string | null; sub: string | null }): string {
  if (user.email) return user.email;
  if (!user.sub) return '-';
  return user.sub.length > 12 ? `${user.sub.slice(0, 12)}…` : user.sub;
}

export type UserFilter = 'all' | 'disabled';

// 목록은 한 번에 받고 이메일 검색과 "사용 중지한 커넥터가 있는 사용자"는 화면에서 거른다
export function filterUsers(
  users: readonly AdminUser[],
  search: string,
  filter: UserFilter,
): AdminUser[] {
  const needle = search.trim().toLowerCase();
  return users.filter(
    (user) =>
      (filter === 'all' || user.disabledConnectorCount > 0) &&
      (needle === '' || userLabel(user).toLowerCase().includes(needle)),
  );
}

// 정상 / 오류 / 재연결 필요 / 사용 중지됨. 사용 중지가 먼저다
export function adminConnectorStatus(connector: AdminConnector): {
  label: string;
  variant: BadgeVariant;
} {
  if (connector.disabled) return { label: '사용 중지됨', variant: 'destructive' };
  switch (connector.status) {
    case 'reauth_required':
      return { label: '재연결 필요', variant: 'warning' };
    case 'error':
      return { label: '오류', variant: 'destructive' };
    case 'pending':
      return { label: '연결 중', variant: 'secondary' };
    case 'ok':
      return { label: '정상', variant: 'success' };
  }
}

export const DISABLE_REASON_MAX = 200;

// 사유는 필수, 앞뒤 공백 빼고 200자 이내
export function disableReasonProblem(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed === '') return '사유를 적으세요';
  if (trimmed.length > DISABLE_REASON_MAX) return `사유는 ${DISABLE_REASON_MAX}자 이내입니다`;
  return null;
}
