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

describe('리소스·프롬프트 차단', () => {
  const allowed = ['read_item'];
  const request = (id: number, method: string) => ({ jsonrpc: '2.0', id, method, params: {} });

  it('resources/list·prompts/get은 업스트림에 보내지 않고 -32601로 거부한다', () => {
    for (const method of [
      'resources/list',
      'resources/read',
      'resources/templates/list',
      'resources/subscribe',
      'resources/unsubscribe',
      'prompts/list',
      'prompts/get',
      'completion/complete',
    ]) {
      expect(planInbound(request(1, method), allowed)).toEqual({
        kind: 'deny',
        deniedTools: [],
        response: { jsonrpc: '2.0', id: 1, error: { code: -32601, message: expect.any(String) } },
      });
    }
  });

  it('배치에 섞이면 배치 전체를 거부하고, 목록 밖 툴 호출이 함께 있으면 감사 대상으로 알린다', () => {
    const plan = planInbound(
      [call(1, 'read_item'), request(2, 'prompts/get'), call(3, 'delete_item')],
      allowed,
    );
    expect(plan.kind).toBe('deny');
    if (plan.kind !== 'deny') return;
    expect(plan.deniedTools).toEqual(['delete_item']);
    expect(plan.response).toEqual([
      expect.objectContaining({ id: 1, error: expect.objectContaining({ code: -32600 }) }),
      expect.objectContaining({ id: 2, error: expect.objectContaining({ code: -32601 }) }),
      expect.objectContaining({ id: 3, error: expect.objectContaining({ code: -32602 }) }),
    ]);
  });

  it('id 없는 리소스 메서드도 보내지 않는다', () => {
    expect(planInbound({ jsonrpc: '2.0', method: 'resources/list' }, allowed)).toEqual({
      kind: 'deny',
      deniedTools: [],
      response: null,
    });
  });

  it('비슷한 이름의 다른 메서드는 막지 않는다', () => {
    expect(planInbound(request(1, 'tools/list'), allowed).kind).toBe('forward');
    expect(planInbound(request(1, 'resourcesX/list'), allowed).kind).toBe('forward');
  });

  const tap = () => createResponseTap({ kind: 'forward', toolCalls: new Map() }, allowed, () => {});

  it('initialize capabilities에서 resources·prompts를 뺀다', () => {
    const result = {
      protocolVersion: '2025-06-18',
      capabilities: {
        tools: { listChanged: true },
        logging: {},
        resources: { subscribe: true },
        prompts: {},
        completions: {},
      },
      serverInfo: { name: 'up', version: '1' },
    };
    expect(tap().rewrite({ jsonrpc: '2.0', id: 0, result })).toEqual({
      jsonrpc: '2.0',
      id: 0,
      result: { ...result, capabilities: { tools: { listChanged: true }, logging: {} } },
    });
  });

  it('업스트림의 리소스·프롬프트 알림은 클라이언트에 보내지 않는다', () => {
    const notify = (method: string) => ({ jsonrpc: '2.0', method, params: {} });
    expect(tap().rewrite(notify('notifications/resources/updated'))).toBeUndefined();
    expect(tap().rewrite(notify('notifications/prompts/list_changed'))).toBeUndefined();
    const progress = notify('notifications/progress');
    expect(tap().rewrite([notify('notifications/resources/list_changed'), progress])).toEqual([
      progress,
    ]);
    expect(tap().rewrite([notify('notifications/resources/list_changed')])).toBeUndefined();
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

  it('거부 문구에 되돌려 주는 툴 이름도 같은 상한으로 자른다', () => {
    const plan = planInbound(call(1, 'z'.repeat(5000)), ['read_item']);
    if (plan.kind !== 'deny') throw new Error('expected deny');
    const message = (plan.response as { error: { message: string } }).error.message;
    expect(message).toContain('z'.repeat(MAX_TOOL_NAME_LENGTH));
    expect(message).not.toContain('z'.repeat(MAX_TOOL_NAME_LENGTH + 1));
  });

  it('잘라도 허용목록 판정은 원래 이름으로 한다', () => {
    const allowedName = 'a'.repeat(MAX_TOOL_NAME_LENGTH);
    const plan = planInbound(call(1, `${allowedName}x`), [allowedName]);
    expect(plan.kind).toBe('deny');
  });
});
