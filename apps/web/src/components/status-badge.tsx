import type { EndpointStatus } from '../api/types.ts';
import { endpointStatusView } from '../features/endpoints/status.ts';
import { Badge } from './ui/badge.tsx';

// hint는 커넥터 인증 방식에 맞춘 안내(endpointStatusHint)를 넘길 때만 쓴다
export function StatusBadge({ status, hint }: { status: EndpointStatus; hint?: string }) {
  const view = endpointStatusView[status];
  return (
    <Badge variant={view.variant} title={hint ?? view.hint}>
      {view.label}
    </Badge>
  );
}
