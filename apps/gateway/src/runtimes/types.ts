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
  // reauthRequired: 업스트림 토큰 갱신이 거부되어 사용자가 다시 연결해야 한다
  | { result: Exclude<ConnectionTestResult, 'ok'>; reauthRequired?: true };

// gateway가 복호화한 자격증명을 실어 런타임에 넘긴다
export type RuntimeConnector = {
  manifest: ConnectorManifest;
  credentials: Readonly<Record<string, string>>;
  // 저장된 커넥터면 자격증명 행. 갱신한 업스트림 토큰을 다시 저장할 때 쓴다. 저장 전 테스트에는 없다
  credentialRef?: { connectorId: string; userId: string } | undefined;
};

// 클라이언트의 Streamable HTTP 요청 하나. headers는 화이트리스트를 거친 값이고 Authorization은 없다
export type ForwardRequest = {
  method: 'GET' | 'POST' | 'DELETE';
  headers: Readonly<Record<string, string>>;
  body?: string | undefined;
  signal: AbortSignal;
  // 사용자가 고칠 수 있는 오류 문구에 넣을 관리 화면 주소 (F-RUN-03)
  adminUrl: string;
};

export interface ConnectorRuntime {
  // 연결 테스트: 업스트림 tools/list가 성공하면 툴 목록을 돌려준다 (F-CON-05)
  testConnection(connector: RuntimeConnector): Promise<ConnectionTest>;
  // MCP 요청을 업스트림 MCP 서버에 전달하고 응답을 그대로 돌려준다.
  // 허용목록·감사 로그는 호출하는 쪽이 메시지 단위로 처리한다. 전송 실패는 UpstreamError로 던진다
  forward(connector: RuntimeConnector, request: ForwardRequest): Promise<Response>;
}
