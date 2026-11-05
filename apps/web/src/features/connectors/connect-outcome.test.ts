import { describe, expect, it } from 'vitest';
import { connectErrorMessages, connectOutcome, homeConnectNotice } from './builtin.ts';

// 업스트림 OAuth state 쿠키가 만료·불일치하면 gateway가 홈으로 보낸다 (SCR-EP-01, SCR-EP-02 오류)
describe('홈으로 돌아온 계정 연결 결과', () => {
  it('expired를 failed와 구분한다', () => {
    expect(connectOutcome(new URLSearchParams('connect_error=expired'))).toBe('expired');
    expect(connectErrorMessages.expired).toContain('10분');
  });

  it('만료는 연결 시간 안내, 그 밖의 실패는 일반 안내', () => {
    expect(homeConnectNotice('expired')).toBe(
      '계정 연결 시간(10분)이 지나 연결을 마치지 못했습니다. 엔드포인트 상세나 추가 화면에서 다시 연결하세요',
    );
    expect(homeConnectNotice('failed')).toBe(
      '계정 연결을 마치지 못했습니다. 엔드포인트 상세나 추가 화면에서 다시 연결하세요',
    );
    expect(homeConnectNotice('connected')).toBeNull();
    expect(homeConnectNotice(null)).toBeNull();
  });
});
