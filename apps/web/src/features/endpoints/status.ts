import type { ConnectorAuthView, EndpointStatus, EndpointSummary } from '../../api/types.ts';
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

// 서비스 계정 커넥터의 상태 안내. 서비스 계정은 다시 연결이 없고 키 파일을 교체한다.
// gateway는 키 거부를 커넥터 오류로 남기고, 그 전에는 재연결 필요로 남겼다(옛 커넥터)
const serviceAccountHints: Partial<Record<EndpointStatus, string>> = {
  reauth_required: '호출이 실패합니다. 엔드포인트 상세에서 서비스 계정 키 파일을 교체하세요.',
  connector_error:
    '서비스 계정 키가 거부되었을 수 있습니다. 엔드포인트 상세에서 연결 테스트를 하고, 거부되면 키 파일을 교체하세요.',
};

// /api/endpoints는 커넥터 인증 방식을 주지 않는다. 커넥터 목록·상세를 받은 화면만 authType을 넘긴다
export function endpointStatusHint(
  status: EndpointStatus,
  authType?: ConnectorAuthView['type'],
): string | undefined {
  if (authType === 'service_account' && serviceAccountHints[status]) {
    return serviceAccountHints[status];
  }
  return endpointStatusView[status].hint;
}

// 재연결이 필요한 커넥터마다 배너 하나. 버튼은 그 커넥터를 쓰는 첫 엔드포인트로 간다 (SCR-EP-01 알림 배너)
// 서비스 계정 커넥터(옛 reauth_required)는 다시 연결 대신 키 교체로 안내한다
export type ReauthBanner = {
  connectorId: string;
  connectorName: string;
  endpointCount: number;
  firstEndpointId: string;
  fix: 'reconnect' | 'replace_key';
};

export function reauthBanners(
  endpoints: readonly EndpointSummary[],
  serviceAccountConnectorIds: ReadonlySet<string> = new Set(),
): ReauthBanner[] {
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
      fix: serviceAccountConnectorIds.has(endpoint.connector.id) ? 'replace_key' : 'reconnect',
    });
  }
  return [...banners.values()];
}

// 레이아웃 메뉴 "내 엔드포인트" 배지에 쓰는 재연결 필요 엔드포인트 수 (index.md 재연결 알림, SCR-COM-01)
export function reauthRequiredCount(endpoints: readonly EndpointSummary[]): number {
  return endpoints.filter((endpoint) => endpoint.status === 'reauth_required').length;
}
