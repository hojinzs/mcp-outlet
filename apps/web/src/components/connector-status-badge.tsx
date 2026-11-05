import type { Connector } from '../api/types.ts';
import { Badge } from './ui/badge.tsx';

// 커넥터 상태 배지. 정상이면 그리지 않는다. 사용 중지가 먼저다
export function ConnectorStatusBadge({ connector }: { connector: Connector }) {
  if (connector.disabledAt !== null) return <Badge variant="destructive">사용 중지됨</Badge>;
  switch (connector.status) {
    case 'pending':
      // 계정 연결 전에 먼저 저장한 커넥터
      return <Badge variant="secondary">연결 중</Badge>;
    case 'error':
      return <Badge variant="destructive">커넥터 오류</Badge>;
    case 'reauth_required':
      return <Badge variant="warning">재연결 필요</Badge>;
    case 'ok':
      return null;
  }
}
