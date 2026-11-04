import type { ConnectorManifest } from '@mcp-outlet/shared';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { connectionTestResult } from '../db/schema.ts';

// 런타임(remote·builtin)별 동작은 이 인터페이스 뒤에 둔다. 호출하는 쪽은 runtime 값으로 분기하지 않는다

// connectors.toolsCache에 저장하는 툴 정보 (F-CON-05: 이름·설명·annotations)
export type CachedTool = {
  name: string;
  title?: string | undefined;
  description?: string | undefined;
  annotations?: ToolAnnotations | undefined;
};

export type ConnectionTestResult = (typeof connectionTestResult.enumValues)[number];

export type ConnectionTest =
  | { result: 'ok'; tools: CachedTool[] }
  | { result: Exclude<ConnectionTestResult, 'ok'> };

// gateway가 복호화한 자격증명을 실어 런타임에 넘긴다
export type RuntimeConnector = {
  manifest: ConnectorManifest;
  credentials: Readonly<Record<string, string>>;
};

export interface ConnectorRuntime {
  // 연결 테스트: 업스트림 tools/list가 성공하면 툴 목록을 돌려준다 (F-CON-05)
  testConnection(connector: RuntimeConnector): Promise<ConnectionTest>;
}
