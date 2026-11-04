import { describe, expect, it } from 'vitest';
import type { Builtin, Connector } from '../../api/types.ts';
import { connectorKindLabel, serviceNamesByConnector } from './connector-kind.ts';

const ga = { key: 'google-analytics', name: 'Google Analytics 4 + Search Console' } as Builtin;

describe('커넥터 종류', () => {
  it('원격은 "원격 MCP", 내장은 서비스 이름. 모르면 "내장 서비스"', () => {
    expect(connectorKindLabel('remote', 'x')).toBe('원격 MCP');
    expect(connectorKindLabel('builtin', ga.name)).toBe(ga.name);
    expect(connectorKindLabel('builtin', null)).toBe('내장 서비스');
    expect(connectorKindLabel('builtin')).toBe('내장 서비스');
  });

  it('커넥터 목록과 내장 서비스 목록으로 커넥터별 서비스 이름을 찾는다', () => {
    const connectors = [
      { id: 'c1', builtin: 'google-analytics' },
      { id: 'c2', builtin: null },
      { id: 'c3', builtin: 'gone' },
    ] as Connector[];
    const names = serviceNamesByConnector(connectors, [ga]);
    expect([...names]).toEqual([['c1', ga.name]]);
    expect(serviceNamesByConnector(undefined, [ga]).size).toBe(0);
  });
});
