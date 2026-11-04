import type { EndpointStatus, EndpointSummary } from '../../api/types.ts';
import type { BadgeVariant } from '../../components/ui/badge.tsx';

// SCR-EP-01 상태 규칙. 상태 계산은 gateway가 하고 화면은 문구와 색만 정한다
export const endpointStatusView: Record<
  EndpointStatus,
  { label: string; variant: BadgeVariant; hint?: string }
> = {
  disabled: {
    label: '사용 중지됨',
    variant: 'destructive',
    hint: '호출이 거부됩니다. 관리자에게 문의하세요.',
  },
  reauth_required: {
    label: '재연결 필요',
    variant: 'warning',
    hint: '호출이 실패합니다. 엔드포인트 상세에서 다시 연결하세요.',
  },
  connector_error: {
    label: '커넥터 오류',
    variant: 'destructive',
    hint: '토큰이나 주소가 바뀌었을 수 있습니다. 엔드포인트 상세에서 확인하세요.',
  },
  inactive: { label: '비활성', variant: 'secondary' },
  active: { label: '활성', variant: 'success' },
};

// 재연결이 필요한 커넥터마다 배너 하나. 버튼은 그 커넥터를 쓰는 첫 엔드포인트로 간다 (SCR-EP-01 알림 배너)
export type ReauthBanner = {
  connectorId: string;
  connectorName: string;
  endpointCount: number;
  firstEndpointId: string;
};

export function reauthBanners(endpoints: readonly EndpointSummary[]): ReauthBanner[] {
  const banners = new Map<string, ReauthBanner>();
  for (const endpoint of endpoints) {
    if (endpoint.status !== 'reauth_required') continue;
    const existing = banners.get(endpoint.connector.id);
    if (existing) {
      existing.endpointCount += 1;
      continue;
    }
    banners.set(endpoint.connector.id, {
      connectorId: endpoint.connector.id,
      connectorName: endpoint.connector.name,
      endpointCount: 1,
      firstEndpointId: endpoint.id,
    });
  }
  return [...banners.values()];
}
