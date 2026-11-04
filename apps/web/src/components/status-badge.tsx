import type { EndpointStatus } from '../api/types.ts';
import { endpointStatusView } from '../features/endpoints/status.ts';
import { Badge } from './ui/badge.tsx';

export function StatusBadge({ status }: { status: EndpointStatus }) {
  const view = endpointStatusView[status];
  return (
    <Badge variant={view.variant} title={view.hint}>
      {view.label}
    </Badge>
  );
}
