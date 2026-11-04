import type { ConnectorRuntime } from '../../api/types.ts';

// 커넥터 종류 문구 (SCR-EP-01 커넥터 열). 내장 서비스는 커넥터 이름이 곧 서비스 이름이다
export function connectorKindLabel(runtime: ConnectorRuntime): string {
  return runtime === 'remote' ? '원격 MCP' : '내장 서비스';
}
