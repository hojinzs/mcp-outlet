import { describe, expect, it } from 'vitest';
import type { EndpointStatus, EndpointSummary } from '../../api/types.ts';
import { reauthBanners, reauthRequiredCount } from './status.ts';

function endpoint(id: string, connectorId: string, status: EndpointStatus): EndpointSummary {
  return {
    id,
    name: id,
    url: `https://outlet.test/c/${id}/mcp`,
    enabled: true,
    status,
    connector: {
      id: connectorId,
      name: `커넥터 ${connectorId}`,
      runtime: 'builtin',
      url: null,
      builtin: 'google-analytics',
      disabledReason: null,
      lastTestedAt: null,
      lastTestResult: null,
    },
    toolCounts: { allowed: 1, total: 1, new: 0 },
    lastCalledAt: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  };
}

describe('재연결 배너', () => {
  it('재연결이 필요한 커넥터마다 하나, 엔드포인트 수와 첫 엔드포인트', () => {
    const banners = reauthBanners([
      endpoint('e1', 'ga', 'active'),
      endpoint('e2', 'ga', 'reauth_required'),
      endpoint('e3', 'ga', 'reauth_required'),
      endpoint('e4', 'cms', 'connector_error'),
    ]);
    expect(banners).toEqual([
      { connectorId: 'ga', connectorName: '커넥터 ga', endpointCount: 2, firstEndpointId: 'e2' },
    ]);
  });

  it('없으면 빈 목록', () => {
    expect(reauthBanners([endpoint('e1', 'x', 'disabled')])).toEqual([]);
  });
});

describe('재연결 메뉴 배지', () => {
  it('재연결 필요 엔드포인트만 센다', () => {
    expect(
      reauthRequiredCount([
        endpoint('e1', 'ga', 'reauth_required'),
        endpoint('e2', 'ga', 'reauth_required'),
        endpoint('e3', 'cms', 'connector_error'),
        endpoint('e4', 'cms', 'active'),
      ]),
    ).toBe(2);
    expect(reauthRequiredCount([])).toBe(0);
  });
});
