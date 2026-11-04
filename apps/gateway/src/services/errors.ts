import type { ConnectionTestResult } from '../runtimes/types.ts';

// 서비스가 HTTP를 모른 채 실패를 알리는 분류. http/errors.ts가 상태 코드와 문구로 바꾼다
export type ServiceErrorCode =
  | 'not_found'
  | 'invalid_request'
  | 'limit_exceeded'
  | 'tools_changed'
  | 'connection_test_failed';

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  // 화면이 분류별 문구를 고를 때 쓰는 값. 원문 예외·업스트림 본문은 담지 않는다
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ServiceErrorCode, details?: Record<string, unknown>) {
    super(code);
    this.name = 'ServiceError';
    this.code = code;
    this.details = details;
  }
}

export function connectionTestFailed(result: Exclude<ConnectionTestResult, 'ok'>): ServiceError {
  return new ServiceError('connection_test_failed', { result });
}
