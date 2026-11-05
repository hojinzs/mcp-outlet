import type { Connector, EndpointSummary } from '../../api/types.ts';

// 커넥터를 지우면 함께 지워지는 엔드포인트 (F-CON-04, SCR-EP-03 커넥터 삭제)
export function endpointsOfConnector(
  endpoints: readonly EndpointSummary[] | undefined,
  connectorId: string,
): EndpointSummary[] {
  return (endpoints ?? []).filter((endpoint) => endpoint.connector.id === connectorId);
}

// 엔드포인트 없이 남아 사용자당 커넥터 상한을 차지하는 커넥터 (SCR-EP-01)
export function orphanConnectors(connectors: readonly Connector[] | undefined): Connector[] {
  return (connectors ?? []).filter((connector) => connector.endpointCount === 0);
}
