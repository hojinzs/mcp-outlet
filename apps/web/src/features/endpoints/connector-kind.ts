import type { Builtin, Connector, ConnectorRuntime } from '../../api/types.ts';
import { builtinNameOf } from '../connectors/builtin.ts';

// 커넥터 종류 문구 (SCR-EP-01 커넥터 열: 원격 MCP / 내장 서비스 이름).
// 서비스 이름을 아직 모르면 "내장 서비스"로 둔다
export function connectorKindLabel(runtime: ConnectorRuntime, serviceName?: string | null): string {
  if (runtime === 'remote') return '원격 MCP';
  return serviceName ?? '내장 서비스';
}

// 커넥터 목록 응답의 builtin key로 내장 서비스 이름을 찾는다
export function serviceNamesByConnector(
  connectors: readonly Connector[] | undefined,
  builtins: readonly Builtin[] | undefined,
): Map<string, string> {
  const names = new Map<string, string>();
  for (const connector of connectors ?? []) {
    const name = builtinNameOf(builtins, connector.builtin);
    if (name) names.set(connector.id, name);
  }
  return names;
}
