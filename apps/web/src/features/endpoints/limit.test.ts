import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { limitExceededText } from './limit.ts';

const limitError = (details?: Record<string, unknown>) =>
  new ApiError(409, { code: 'limit_exceeded', message: '서버 문구', details });

describe('limit_exceeded 문구', () => {
  it('커넥터 상한은 숫자와 함께 엔드포인트 없는 커넥터를 지우라고 안내한다', () => {
    expect(limitExceededText(limitError({ resource: 'connector', limit: 20 }))).toBe(
      '커넥터는 최대 20개까지 만들 수 있습니다. 엔드포인트 없는 커넥터를 지우면 자리가 납니다',
    );
  });

  it('엔드포인트 상한', () => {
    expect(limitExceededText(limitError({ resource: 'endpoint', limit: 50 }))).toBe(
      '엔드포인트는 최대 50개까지 만들 수 있습니다',
    );
  });

  it('상한 숫자가 없으면 숫자 없이 말한다', () => {
    expect(limitExceededText(limitError({ resource: 'connector' }))).toBe(
      '만들 수 있는 커넥터 개수의 상한에 도달했습니다. 엔드포인트 없는 커넥터를 지우면 자리가 납니다',
    );
    expect(limitExceededText(limitError({ resource: 'endpoint', limit: '50' }))).toBe(
      '만들 수 있는 엔드포인트 개수의 상한에 도달했습니다',
    );
  });

  it('resource를 모르면 공통 문구', () => {
    expect(limitExceededText(limitError())).toBe('만들 수 있는 개수의 상한에 도달했습니다');
  });

  it('limit_exceeded가 아니면 null', () => {
    expect(limitExceededText(new ApiError(409, { code: 'tools_changed' }))).toBeNull();
    expect(limitExceededText(new Error('x'))).toBeNull();
  });
});
