import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '../api/client.ts';
import { pageErrorKind } from './page-error.ts';

describe('화면 오류 종류', () => {
  it('상태 코드와 연결 끊김으로 나눈다', () => {
    expect(pageErrorKind(new NetworkError())).toBe('offline');
    expect(pageErrorKind(new ApiError(404, { code: 'not_found' }))).toBe('not_found');
    expect(pageErrorKind(new ApiError(401, {}))).toBe('redirecting');
    expect(pageErrorKind(new ApiError(403, {}))).toBe('redirecting');
    expect(pageErrorKind(new ApiError(500, {}, 'req-1'))).toBe('server');
    expect(pageErrorKind(new Error('boom'))).toBe('server');
  });
});
