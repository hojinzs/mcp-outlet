import { describe, expect, it } from 'vitest';
import {
  auditApiQuery,
  errorRate,
  readAuditFilter,
  retentionNotice,
  withUser,
  writeAuditFilter,
} from './audit-filter.ts';

const read = (search: string) => readAuditFilter(new URLSearchParams(search));

describe('감사 로그 필터 (SCR-ADM-06)', () => {
  it('주소에서 읽고 다시 쓰면 같고, 기본값과 틀린 값은 주소에 남지 않는다', () => {
    const state = read('user=u1&endpoint=e1&result=denied&tool=read&period=7d');
    expect(state).toMatchObject({ period: '7d', userId: 'u1', endpointId: 'e1', result: 'denied' });
    expect(writeAuditFilter(state).toString()).toBe(
      'period=7d&user=u1&endpoint=e1&result=denied&tool=read',
    );
    const odd = read('period=1y&result=blocked');
    expect(odd).toMatchObject({ period: '24h', result: '' });
    expect(writeAuditFilter(odd).toString()).toBe('');
  });

  it('사용자를 바꾸면 엔드포인트·커넥터 선택을 푼다', () => {
    expect(withUser(read('user=u1&endpoint=e1&connector=c1'), 'u2')).toMatchObject({
      userId: 'u2',
      endpointId: '',
      connectorId: '',
    });
  });

  it('최근 기간은 분 단위로 내림한 지금부터 세고, 직접 지정은 그 값을 쓴다', () => {
    const now = new Date('2026-11-05T10:30:45Z');
    const recent = new URLSearchParams(auditApiQuery(read('result=error&tool= get '), now));
    expect(recent.get('from')).toBe('2026-11-04T10:30:00.000Z');
    expect(recent.get('to')).toBeNull();
    expect(recent.get('result')).toBe('error');
    expect(recent.get('tool')).toBe('get');
    // 같은 분 안에서는 같은 쿼리
    expect(auditApiQuery(read(''), new Date('2026-11-05T10:30:59Z'))).toBe(
      auditApiQuery(read(''), now),
    );

    const custom = read('period=custom&from=2026-11-01T00:00&to=bad&user=u1');
    const query = new URLSearchParams(auditApiQuery(custom, now));
    expect(query.get('from')).toBe(new Date('2026-11-01T00:00').toISOString());
    expect(query.get('to')).toBeNull();
    expect(query.get('userId')).toBe('u1');
  });

  it('오류 비율과 보관 기간 문구', () => {
    expect(errorRate(0, 0)).toBe('0%');
    expect(errorRate(1, 3)).toBe('33.3%');
    expect(retentionNotice(90)).toBe('90일이 지난 기록은 지워집니다.');
    expect(retentionNotice(0)).toBe('기록을 지우지 않습니다.');
  });
});
