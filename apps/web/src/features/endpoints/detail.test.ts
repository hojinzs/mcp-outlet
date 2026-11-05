import { describe, expect, it } from 'vitest';
import type { EndpointDetail, RecentCall } from '../../api/types.ts';
import { canAllowFromCall, newToolNames, savedSelection } from './detail.ts';

const detail: EndpointDetail = {
  id: 'e1',
  name: 'ep',
  url: 'https://outlet.test/c/e1/mcp',
  enabled: true,
  status: 'active',
  connector: {
    id: 'c1',
    name: 'cms',
    runtime: 'remote',
    url: 'https://cms.test/mcp',
    builtin: null,
    disabledReason: null,
    lastTestedAt: null,
    lastTestResult: null,
  },
  toolCounts: { allowed: 1, total: 3, new: 1 },
  lastCalledAt: null,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  allowedTools: ['read', 'gone'],
  tools: [
    { name: 'read', allowed: true, isNew: false },
    { name: 'write', allowed: false, isNew: false },
    { name: 'publish', allowed: false, isNew: true },
  ],
  missingTools: ['gone'],
  connectorEndpointCount: 1,
};

const call = (toolName: string, result: RecentCall['result']): RecentCall => ({
  at: '2026-11-02T00:00:00Z',
  toolName,
  result,
  durationMs: 12,
});

describe('엔드포인트 상세 노출 툴', () => {
  it('새 툴은 isNew인 커넥터 툴', () => {
    expect([...newToolNames(detail)]).toEqual(['publish']);
  });

  it('저장된 허용목록에는 사라진 툴도 남긴다', () => {
    expect([...savedSelection(detail)]).toEqual(['read', 'gone']);
  });

  it('거부된 호출 중 아직 고르지 않았고 커넥터에 있는 툴만 허용목록에 추가할 수 있다', () => {
    const selected = savedSelection(detail);
    expect(canAllowFromCall(call('write', 'denied'), detail, selected)).toBe(true);
    expect(canAllowFromCall(call('write', 'error'), detail, selected)).toBe(false);
    expect(canAllowFromCall(call('read', 'denied'), detail, selected)).toBe(false);
    expect(canAllowFromCall(call('unknown', 'denied'), detail, selected)).toBe(false);
  });
});
