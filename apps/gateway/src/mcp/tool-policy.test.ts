import { describe, expect, it } from 'vitest';
import { MAX_TOOL_NAME_LENGTH } from './limits.ts';
import {
  auditToolName,
  createResponseTap,
  deniedAuditNames,
  MAX_DENIED_AUDIT_ROWS,
  planInbound,
} from './tool-policy.ts';

const call = (id: number | string, name: string) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: {} },
});

describe('planInbound', () => {
  const allowed = ['read_item'];

  it('허용된 호출은 id를 기억하고 tools/list와 함께 보낸다', () => {
    const plan = planInbound(
      [call(1, 'read_item'), { jsonrpc: '2.0', id: '1', method: 'tools/list' }],
      allowed,
    );
    expect(plan.kind).toBe('forward');
    if (plan.kind !== 'forward') return;
    expect([...plan.toolCalls]).toEqual([['1', 'read_item']]);
  });

  it('목록 밖 tools/call은 MCP 오류로 거부한다', () => {
    const plan = planInbound(call(7, 'delete_item'), allowed);
    expect(plan).toEqual({
      kind: 'deny',
      deniedTools: ['delete_item'],
      response: {
        jsonrpc: '2.0',
        id: 7,
        error: { code: -32602, message: expect.stringContaining('delete_item') },
      },
    });
  });

  it('배치에 거부할 호출이 섞이면 배치 전체를 응답으로 거부한다', () => {
    const plan = planInbound(
      [call(1, 'read_item'), call(2, 'delete_item'), { jsonrpc: '2.0', method: 'notifications/x' }],
      allowed,
    );
    expect(plan.kind).toBe('deny');
    if (plan.kind !== 'deny') return;
    expect(plan.deniedTools).toEqual(['delete_item']);
    expect(plan.response).toEqual([
      expect.objectContaining({ id: 1, error: expect.objectContaining({ code: -32600 }) }),
      expect.objectContaining({ id: 2, error: expect.objectContaining({ code: -32602 }) }),
    ]);
  });

  it('id 없는 tools/call도 거부하고, 응답할 요청이 없으면 response는 null', () => {
    const plan = planInbound(
      { jsonrpc: '2.0', method: 'tools/call', params: { name: 'x' } },
      allowed,
    );
    expect(plan).toMatchObject({ kind: 'deny', deniedTools: ['x'], response: null });
  });
});

describe('createResponseTap', () => {
  it('tools/list 결과를 허용목록으로 거르고 tools/call 결과를 알린다', () => {
    const plan = planInbound(
      [{ jsonrpc: '2.0', id: 1, method: 'tools/list' }, call(2, 'read_item'), call(3, 'read_item')],
      ['read_item'],
    );
    if (plan.kind !== 'forward') throw new Error('expected forward');
    const outcomes: [string, string][] = [];
    const tap = createResponseTap(plan, ['read_item'], (name, outcome) =>
      outcomes.push([name, outcome]),
    );

    const list = tap.rewrite({
      jsonrpc: '2.0',
      id: 1,
      result: { tools: [{ name: 'read_item' }, { name: 'delete_item' }], nextCursor: 'c' },
    });
    expect(list).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { tools: [{ name: 'read_item' }], nextCursor: 'c' },
    });

    tap.rewrite({ jsonrpc: '2.0', id: 2, result: { content: [], isError: true } });
    // 알림과 다른 id의 응답은 그대로 둔다
    const notification = { jsonrpc: '2.0', method: 'notifications/progress', params: {} };
    expect(tap.rewrite(notification)).toBe(notification);
    tap.settle();
    expect(outcomes).toEqual([
      ['read_item', 'error'],
      ['read_item', 'error'],
    ]);
  });

  it('이 요청에서 보내지 않은 tools/list 응답(GET 스트림 재개)도 허용목록으로 거른다', () => {
    const tap = createResponseTap(
      { kind: 'forward', toolCalls: new Map() },
      ['read_item'],
      () => {},
    );
    const replayed = tap.rewrite([
      { jsonrpc: '2.0', id: 'earlier', result: { tools: [{ name: 'delete_item' }] } },
      { jsonrpc: '2.0', id: 'other', result: { content: [] } },
    ]);
    expect(replayed).toEqual([
      { jsonrpc: '2.0', id: 'earlier', result: { tools: [] } },
      { jsonrpc: '2.0', id: 'other', result: { content: [] } },
    ]);
  });

  it('성공 응답은 ok, 같은 호출을 두 번 알리지 않는다', () => {
    const plan = planInbound(call('a', 'read_item'), ['read_item']);
    if (plan.kind !== 'forward') throw new Error('expected forward');
    const outcomes: string[] = [];
    const tap = createResponseTap(plan, ['read_item'], (_name, outcome) => outcomes.push(outcome));
    tap.rewrite([{ jsonrpc: '2.0', id: 'a', result: { content: [] } }]);
    tap.settle();
    expect(outcomes).toEqual(['ok']);
  });
});

describe('deniedAuditNames', () => {
  it('클라이언트가 보낸 긴 툴 이름은 입력 상한 길이로 자른다', () => {
    expect(deniedAuditNames(['a'.repeat(5000)])).toEqual(['a'.repeat(MAX_TOOL_NAME_LENGTH)]);
  });

  it('서로게이트 쌍 가운데서 자르지 않는다', () => {
    const name = `${'a'.repeat(MAX_TOOL_NAME_LENGTH - 1)}😀`;
    expect(auditToolName(name)).toBe('a'.repeat(MAX_TOOL_NAME_LENGTH - 1));
  });

  it('요청 하나에서 남기는 거부 행 수를 제한한다', () => {
    const names = Array.from({ length: 1000 }, (_, i) => `tool_${i}`);
    const audited = deniedAuditNames(names);
    expect(audited).toHaveLength(MAX_DENIED_AUDIT_ROWS);
    expect(audited[0]).toBe('tool_0');
  });

  it('잘라도 허용목록 판정은 원래 이름으로 한다', () => {
    const allowedName = 'a'.repeat(MAX_TOOL_NAME_LENGTH);
    const plan = planInbound(call(1, `${allowedName}x`), [allowedName]);
    expect(plan.kind).toBe('deny');
  });
});
