import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  apiErrorResult,
  BuiltinApiError,
  errorResult,
  isCredentialRejection,
  jsonResult,
} from './errors.ts';
import type { BuiltinCallContext } from './types.ts';

// 툴 하나: zod 입력 스키마가 MCP inputSchema와 인자 검증을 함께 맡는다

export type ToolDefinition<Input extends z.ZodObject = z.ZodObject> = {
  name: string;
  title: string;
  description: string;
  input: Input;
  // 결과는 JSON 텍스트로 돌려준다
  run(args: z.infer<Input>, ctx: BuiltinCallContext): Promise<unknown>;
};

export function defineTool<Input extends z.ZodObject>(
  definition: ToolDefinition<Input>,
): ToolDefinition {
  return definition as unknown as ToolDefinition;
}

function toMcpTool(definition: ToolDefinition): Tool {
  const { $schema: _, ...schema } = z.toJSONSchema(definition.input, { io: 'input' });
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: schema as Tool['inputSchema'],
    // v1 내장 툴은 모두 조회 전용이다 (F-EP-03 "읽기 전용만")
    annotations: { readOnlyHint: true, openWorldHint: true },
  };
}

function issuesText(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '(인자)'}: ${issue.message}`)
    .join('; ');
}

export function createToolSet(definitions: readonly ToolDefinition[]) {
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));

  function listTools(): Tool[] {
    return definitions.map(toMcpTool);
  }

  async function callTool(
    name: string,
    args: Record<string, unknown>,
    ctx: BuiltinCallContext,
  ): Promise<CallToolResult> {
    const definition = byName.get(name);
    if (!definition) return errorResult(`알 수 없는 툴입니다: ${name}`);
    const parsed = definition.input.safeParse(args);
    if (!parsed.success) {
      return errorResult(`인자가 올바르지 않습니다. ${issuesText(parsed.error)}`);
    }
    try {
      return jsonResult(await definition.run(parsed.data, ctx));
    } catch (error) {
      // 자격증명 거부는 gateway가 커넥터 상태를 바꾸도록 던진다 (SCR-EP-01 상태 규칙)
      if (error instanceof BuiltinApiError && isCredentialRejection(error)) throw error;
      // 분류하지 못한 예외도 원문을 내보내지 않는다 (F-RUN-03)
      return apiErrorResult(
        error instanceof BuiltinApiError ? error : new BuiltinApiError('upstream_error'),
      );
    }
  }

  return { listTools, callTool };
}
