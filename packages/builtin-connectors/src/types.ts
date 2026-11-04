import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

// builtin 커넥터 공통 인터페이스 (F-RUN-02).
// 자격증명은 gateway가 복호화해 함수 인자로 넘긴다.

export interface BuiltinCallContext {
  credentials: Readonly<Record<string, string>>;
  signal: AbortSignal;
}

export interface BuiltinConnector {
  // 매니페스트의 `builtin` 값과 일치하는 키
  key: string;
  listTools(ctx: BuiltinCallContext): Promise<Tool[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    ctx: BuiltinCallContext,
  ): Promise<CallToolResult>;
}
