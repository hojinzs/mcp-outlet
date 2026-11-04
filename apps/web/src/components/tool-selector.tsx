import { useId, useState } from 'react';
import type { Tool } from '../api/types.ts';
import {
  filterTools,
  firstLine,
  isDestructive,
  isReadOnly,
  selectAll,
  selectReadOnly,
  TOOL_SEARCH_THRESHOLD,
  toggle,
} from '../features/tools/selection.ts';
import { Badge } from './ui/badge.tsx';
import { Button } from './ui/button.tsx';
import { Checkbox } from './ui/checkbox.tsx';
import { Input } from './ui/input.tsx';

// 툴 선택 목록 (SCR-EP-02 2단계). 엔드포인트 상세(SCR-EP-03)는 새 툴 묶음과 사라진 툴을 더 넘긴다
export type ToolSelectorProps = {
  tools: readonly Tool[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  // 허용목록을 정한 뒤 커넥터에 생긴 툴. 목록 위에 따로 보여준다
  newTools?: ReadonlySet<string>;
  // 허용목록에 있지만 커넥터 툴 목록에 없는 이름. 목록 끝에 둔다
  missingTools?: readonly string[];
};

function ToolRow({
  tool,
  checked,
  onCheckedChange,
  missing = false,
}: {
  tool: Tool;
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
  missing?: boolean;
}) {
  const id = useId();
  const description = firstLine(tool.description);
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(state) => onCheckedChange(state === true)}
        className="mt-0.5"
      />
      <label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <code className="font-mono text-sm">{tool.name}</code>
          {isReadOnly(tool) && <Badge variant="success">읽기</Badge>}
          {isDestructive(tool) && <Badge variant="destructive">삭제·변경</Badge>}
          {missing && <Badge variant="outline">커넥터에서 사라짐</Badge>}
        </span>
        {description && (
          <span className="truncate text-sm text-muted-foreground">{description}</span>
        )}
      </label>
    </li>
  );
}

export function ToolSelector({
  tools,
  selected,
  onChange,
  newTools,
  missingTools = [],
}: ToolSelectorProps) {
  const [query, setQuery] = useState('');
  const visible = filterTools(tools, query);
  const fresh = visible.filter((tool) => newTools?.has(tool.name));
  const rest = visible.filter((tool) => !newTools?.has(tool.name));
  const missing = missingTools.filter((name) => name.toLowerCase().includes(query.toLowerCase()));

  const row = (tool: Tool, missingRow = false) => (
    <ToolRow
      key={tool.name}
      tool={tool}
      missing={missingRow}
      checked={selected.has(tool.name)}
      onCheckedChange={(on) => onChange(toggle(selected, tool.name, on))}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => onChange(selectAll(tools))}>
          전체 선택
        </Button>
        <Button size="sm" variant="outline" onClick={() => onChange(selectReadOnly(tools))}>
          읽기 전용만
        </Button>
        <Button size="sm" variant="outline" onClick={() => onChange(new Set())}>
          모두 해제
        </Button>
        {tools.length >= TOOL_SEARCH_THRESHOLD && (
          <Input
            type="search"
            placeholder="툴 이름·설명으로 찾기"
            aria-label="툴 찾기"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="ml-auto h-8 w-full sm:w-64"
          />
        )}
      </div>
      <div className="overflow-hidden rounded-lg border bg-background">
        {fresh.length > 0 && (
          <>
            <p className="border-b bg-warning/10 px-4 py-2 text-xs font-medium text-warning">
              새 툴 {fresh.length}개 · 허용하기 전에는 노출되지 않습니다
            </p>
            <ul className="divide-y border-b">{fresh.map((tool) => row(tool))}</ul>
          </>
        )}
        <ul className="divide-y">
          {rest.map((tool) => row(tool))}
          {missing.map((name) => row({ name }, true))}
        </ul>
        {visible.length === 0 && missing.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {tools.length === 0 ? '이 커넥터에는 툴이 없습니다.' : '찾는 툴이 없습니다.'}
          </p>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{selected.size}개 선택</p>
    </div>
  );
}
