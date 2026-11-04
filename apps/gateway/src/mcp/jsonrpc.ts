// MCP 프록시가 들여다보는 최소한의 JSON-RPC 2.0 모양. 나머지 필드는 그대로 통과시킨다

export type JsonRpcId = string | number;

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  result?: unknown;
  error?: { code: number; message: string };
};

// 클라이언트에 돌려주는 오류 코드. 업스트림 원문은 message에 넣지 않는다 (F-RUN-03)
export const RPC_ERROR = {
  parseError: -32700,
  invalidRequest: -32600,
  invalidParams: -32602,
  // 업스트림 연결·인증 실패 (서버 정의 영역)
  upstream: -32000,
  // 엔드포인트 비활성·사용 중지·권한 없음
  forbidden: -32001,
} as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || typeof value === 'number';
}

export function isRequest(message: unknown): message is JsonRpcRequest {
  return isObject(message) && typeof message.method === 'string' && isId(message.id);
}

export function isResponse(message: unknown): message is JsonRpcResponse & { id: JsonRpcId } {
  return (
    isObject(message) &&
    message.method === undefined &&
    isId(message.id) &&
    ('result' in message || 'error' in message)
  );
}

// 1과 "1"을 구분하는 Map 키
export function idKey(id: JsonRpcId): string {
  return JSON.stringify(id);
}

export function errorResponse(
  id: JsonRpcId | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
