import { describe, expect, it } from 'vitest';
import type { Connector, EndpointSummary } from '../../api/types.ts';
import { endpointsOfConnector, orphanConnectors } from './deletion.ts';

const endpoint = (id: string, connectorId: string) =>
  ({ id, name: id, connector: { id: connectorId } }) as EndpointSummary;
const connector = (id: string, endpointCount: number) => ({ id, endpointCount }) as Connector;

describe('커넥터 삭제', () => {
  it('그 커넥터를 쓰는 엔드포인트만 고른다', () => {
    const endpoints = [endpoint('e1', 'c1'), endpoint('e2', 'c2'), endpoint('e3', 'c1')];
    expect(endpointsOfConnector(endpoints, 'c1').map((item) => item.id)).toEqual(['e1', 'e3']);
    expect(endpointsOfConnector(undefined, 'c1')).toEqual([]);
  });

  it('엔드포인트가 없는 커넥터만 고른다', () => {
    const connectors = [connector('c1', 0), connector('c2', 2), connector('c3', 0)];
    expect(orphanConnectors(connectors).map((item) => item.id)).toEqual(['c1', 'c3']);
  });
});
