import type { Tool } from '../../api/types.ts';

// 툴 선택 목록 규칙 (SCR-EP-02 2단계, SCR-EP-03 노출 툴)

// 검색은 툴이 10개 이상일 때만 보여준다
export const TOOL_SEARCH_THRESHOLD = 10;

// 힌트가 없는 툴은 읽기 전용으로 치지 않는다 (F-EP-03)
export function isReadOnly(tool: Tool): boolean {
  return tool.annotations?.readOnlyHint === true;
}

export function isDestructive(tool: Tool): boolean {
  return tool.annotations?.destructiveHint === true;
}

function toolNames(tools: readonly Tool[]): Set<string> {
  return new Set(tools.map((tool) => tool.name));
}

// 일괄 선택은 커넥터 툴 목록에만 적용한다. 목록에 없는 이름(사라진 툴)의 선택은
// 사용자가 체크를 직접 풀 때만 빠지므로 그대로 둔다 (SCR-EP-03 사라진 툴)
function replaceAmong(
  selected: ReadonlySet<string>,
  tools: readonly Tool[],
  picked: readonly Tool[],
): Set<string> {
  const names = toolNames(tools);
  const kept = [...selected].filter((name) => !names.has(name));
  return new Set([...kept, ...picked.map((tool) => tool.name)]);
}

export function selectAll(selected: ReadonlySet<string>, tools: readonly Tool[]): Set<string> {
  return replaceAmong(selected, tools, tools);
}

// 읽기 전용만 선택하고 나머지는 해제한다
export function selectReadOnly(selected: ReadonlySet<string>, tools: readonly Tool[]): Set<string> {
  return replaceAmong(selected, tools, tools.filter(isReadOnly));
}

export function clearAll(selected: ReadonlySet<string>, tools: readonly Tool[]): Set<string> {
  return replaceAmong(selected, tools, []);
}

export function toggle(selected: ReadonlySet<string>, name: string, on: boolean): Set<string> {
  const next = new Set(selected);
  if (on) next.add(name);
  else next.delete(name);
  return next;
}

export function firstLine(text: string | undefined): string {
  return (
    text
      ?.split('\n')
      .find((line) => line.trim())
      ?.trim() ?? ''
  );
}

export function filterTools<T extends Tool>(tools: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...tools];
  return tools.filter(
    (tool) =>
      tool.name.toLowerCase().includes(needle) ||
      (tool.description ?? '').toLowerCase().includes(needle),
  );
}

// 3단계 요약의 경고 수: 고른 툴 중 읽기 전용이 아닌 것
export function countNotReadOnly(tools: readonly Tool[], selected: ReadonlySet<string>): number {
  return tools.filter((tool) => selected.has(tool.name) && !isReadOnly(tool)).length;
}

// 툴 목록이 바뀐 뒤에도 남아 있는 것만 선택을 유지한다 (저장 직전 tools_changed)
export function keepAvailable(selected: ReadonlySet<string>, tools: readonly Tool[]): Set<string> {
  const names = toolNames(tools);
  return new Set([...selected].filter((name) => names.has(name)));
}

export function sameSelection(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((name) => b.has(name));
}
