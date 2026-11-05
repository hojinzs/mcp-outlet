import { describe, expect, it } from 'vitest';
import type { Connector } from '../../api/types.ts';
import { lastTestView, transientFailureNote } from './last-test.ts';

const formatTime = (value: string | null) => value ?? '-';

const base: Pick<Connector, 'runtime' | 'status' | 'lastTestResult' | 'lastTestedAt'> = {
  runtime: 'remote',
  status: 'ok',
  lastTestResult: 'ok',
  lastTestedAt: '2026-11-06T01:00:00Z',
};

describe('마지막 연결 테스트', () => {
  it('테스트한 적이 없으면 없음', () => {
    expect(lastTestView({ ...base, lastTestResult: null, lastTestedAt: null }, formatTime)).toEqual(
      { text: '마지막 연결 테스트: 없음', tone: 'none', note: null },
    );
  });

  it('성공이면 시각과 성공', () => {
    expect(lastTestView(base, formatTime)).toEqual({
      text: '마지막 연결 테스트: 2026-11-06T01:00:00Z · 성공',
      tone: 'ok',
      note: null,
    });
  });

  it('상태가 정상인데 실패했으면 일시 실패로 알린다', () => {
    const timeout = lastTestView({ ...base, lastTestResult: 'timeout' }, formatTime);
    expect(timeout.tone).toBe('transient');
    expect(timeout.text).toBe(
      '마지막 연결 테스트: 2026-11-06T01:00:00Z · 커넥터 응답이 너무 늦습니다. 잠시 후 다시 시도하세요',
    );
    expect(timeout.note).toBe(transientFailureNote);
  });

  it('내장 서비스는 내장 문구를 쓴다', () => {
    const denied = lastTestView(
      { ...base, runtime: 'builtin', lastTestResult: 'permission_denied' },
      formatTime,
    );
    expect(denied.tone).toBe('transient');
    expect(denied.text).toContain('GA 속성·Search Console 사이트 권한');
    const upstream = lastTestView(
      { ...base, runtime: 'builtin', lastTestResult: 'upstream_error' },
      formatTime,
    );
    expect(upstream.text).toContain('잠시 후 다시 시도');
  });

  it('상태가 정상이 아니면 실패로 보이고 따로 설명하지 않는다', () => {
    for (const status of ['error', 'reauth_required', 'pending'] as const) {
      expect(lastTestView({ ...base, status, lastTestResult: 'auth_failed' }, formatTime)).toEqual({
        text: '마지막 연결 테스트: 2026-11-06T01:00:00Z · 서버가 토큰을 거부했습니다. 토큰과 헤더 설정을 확인하세요',
        tone: 'failed',
        note: null,
      });
    }
  });
});
