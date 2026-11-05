import { describe, expect, it } from 'vitest';
import type { Tool } from '../../api/types.ts';
import {
  clearAll,
  countNotReadOnly,
  filterTools,
  firstLine,
  keepAvailable,
  sameSelection,
  selectAll,
  selectReadOnly,
  toggle,
} from './selection.ts';

const tools: Tool[] = [
  {
    name: 'get_item',
    description: '항목 하나를 읽는다\n자세한 설명',
    annotations: { readOnlyHint: true },
  },
  { name: 'list_items', annotations: { readOnlyHint: true, destructiveHint: false } },
  { name: 'delete_item', description: 'Delete', annotations: { destructiveHint: true } },
  { name: 'update_item', annotations: { readOnlyHint: false } },
  { name: 'echo' },
];

describe('툴 일괄 선택', () => {
  it('읽기 전용만은 readOnlyHint === true인 툴만 고르고 힌트 없는 툴은 뺀다', () => {
    expect([...selectReadOnly(new Set(['echo']), tools)]).toEqual(['get_item', 'list_items']);
  });

  it('전체 선택과 토글', () => {
    expect(selectAll(new Set(), tools).size).toBe(5);
    const one = toggle(new Set(), 'echo', true);
    expect([...one]).toEqual(['echo']);
    expect(toggle(one, 'echo', false).size).toBe(0);
  });

  it('일괄 선택·해제는 커넥터에서 사라진 툴의 선택을 건드리지 않는다 (SCR-EP-03)', () => {
    const selected = new Set(['gone', 'delete_item']);
    expect([...selectAll(selected, tools)].sort()).toEqual(
      ['delete_item', 'echo', 'get_item', 'gone', 'list_items', 'update_item'].sort(),
    );
    expect([...selectReadOnly(selected, tools)].sort()).toEqual(['get_item', 'gone', 'list_items']);
    expect([...clearAll(selected, tools)]).toEqual(['gone']);
  });

  it('사라진 툴은 사용자가 직접 풀면 빠진다', () => {
    expect([...toggle(new Set(['gone', 'echo']), 'gone', false)]).toEqual(['echo']);
  });

  it('읽기 전용이 아닌 선택 수', () => {
    expect(countNotReadOnly(tools, new Set(['get_item', 'echo', 'delete_item']))).toBe(2);
  });
});

describe('검색·표시', () => {
  it('이름과 설명으로 거른다 (대소문자 무시)', () => {
    expect(filterTools(tools, 'ITEM').map((t) => t.name)).toEqual([
      'get_item',
      'list_items',
      'delete_item',
      'update_item',
    ]);
    expect(filterTools(tools, 'delete').map((t) => t.name)).toEqual(['delete_item']);
    expect(filterTools(tools, '읽는다').map((t) => t.name)).toEqual(['get_item']);
    expect(filterTools(tools, '  ')).toHaveLength(5);
  });

  it('설명 첫 줄', () => {
    expect(firstLine('\n  첫 줄 \n둘째')).toBe('첫 줄');
    expect(firstLine(undefined)).toBe('');
  });
});

describe('툴 목록 변경', () => {
  it('사라진 툴은 선택에서 뺀다', () => {
    const kept = keepAvailable(new Set(['echo', 'gone']), tools);
    expect([...kept]).toEqual(['echo']);
  });

  it('같은 선택인지', () => {
    expect(sameSelection(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
    expect(sameSelection(new Set(['a']), new Set(['a', 'b']))).toBe(false);
  });
});
