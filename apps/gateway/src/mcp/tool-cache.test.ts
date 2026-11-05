import { describe, expect, it } from 'vitest';
import { MAX_CACHED_TOOLS, sameTools, toolsFromListResult } from './tool-cache.ts';

const tool = (name: string) => ({ name, inputSchema: { type: 'object' } });

describe('toolsFromListResult', () => {
  it('캐시에 저장하는 필드만 남긴다', () => {
    expect(
      toolsFromListResult({
        tools: [{ ...tool('a'), description: 'd', annotations: { readOnlyHint: true } }],
      }),
    ).toEqual([
      {
        name: 'a',
        title: undefined,
        description: 'd',
        annotations: { readOnlyHint: true },
      },
    ]);
  });

  it('nextCursor가 있으면 목록이 온전하지 않아 null', () => {
    expect(toolsFromListResult({ tools: [tool('a')], nextCursor: 'next' })).toBeNull();
  });

  it('MCP 모양이 아니거나 상한을 넘으면 null', () => {
    expect(toolsFromListResult({ tools: [{ name: 1 }] })).toBeNull();
    expect(toolsFromListResult({ tools: [{ name: 'a' }] })).toBeNull();
    const many = Array.from({ length: MAX_CACHED_TOOLS + 1 }, (_, i) => tool(`t${i}`));
    expect(toolsFromListResult({ tools: many })).toBeNull();
  });
});

describe('sameTools', () => {
  it('키 순서가 달라도(jsonb) 같은 툴이면 같다', () => {
    expect(
      sameTools(
        [{ name: 'a', description: 'd', annotations: { readOnlyHint: true, title: 't' } }],
        [{ annotations: { title: 't', readOnlyHint: true }, description: 'd', name: 'a' }],
      ),
    ).toBe(true);
  });

  it('설명·annotations·순서가 바뀌면 다르다', () => {
    const a = { name: 'a', description: 'd' };
    const b = { name: 'b' };
    expect(sameTools([a], [{ ...a, description: 'e' }])).toBe(false);
    expect(sameTools([a], [{ ...a, annotations: { readOnlyHint: true } }])).toBe(false);
    expect(sameTools([a, b], [b, a])).toBe(false);
  });
});
