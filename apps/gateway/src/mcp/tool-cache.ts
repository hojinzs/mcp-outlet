import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CachedTool } from '../runtimes/types.ts';

// 커넥터 툴 캐시에 저장하는 모양. 연결 테스트와 프록시를 지나는 tools/list가 같은 형태로 저장한다
// (SCR-EP-01·03 "새 툴", 툴 캐시 갱신)

// 허용목록 입력 상한(toolNameList)과 같다. 이보다 많은 툴은 고를 수도 없다
export const MAX_CACHED_TOOLS = 1000;

export function toCachedTool(tool: CachedTool): CachedTool {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    annotations: tool.annotations,
  };
}

// 프록시를 지나는 tools/list 결과에서 캐시할 툴 목록. 페이지가 남았거나(nextCursor)
// MCP 모양이 아니거나 상한을 넘으면 목록이 온전하지 않으므로 null
export function toolsFromListResult(result: unknown): CachedTool[] | null {
  const parsed = ListToolsResultSchema.safeParse(result);
  if (!parsed.success) return null;
  if (parsed.data.nextCursor) return null;
  if (parsed.data.tools.length > MAX_CACHED_TOOLS) return null;
  return parsed.data.tools.map(toCachedTool);
}

// jsonb는 키 순서를 바꿔 저장하므로 키를 정렬해 비교한다
function canonical(tools: readonly CachedTool[]): string {
  return JSON.stringify(tools.map(toCachedTool), (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value,
  );
}

export function sameTools(a: readonly CachedTool[], b: readonly CachedTool[]): boolean {
  return canonical(a) === canonical(b);
}
