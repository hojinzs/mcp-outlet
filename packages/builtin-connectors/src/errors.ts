import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// 업스트림 API 오류 분류. 원문 예외와 응답 본문은 담지 않는다 (F-RUN-03)
export type BuiltinErrorKind =
  | 'auth_failed'
  | 'permission_denied'
  | 'not_found'
  | 'invalid_argument'
  | 'rate_limited'
  | 'timeout'
  | 'unreachable'
  | 'upstream_error';

export class BuiltinApiError extends Error {
  readonly kind: BuiltinErrorKind;
  // invalid_argument일 때만: 업스트림이 준 인자 오류 설명(error.message 필드). 모델이 인자를 고칠 수 있게 넘긴다
  readonly hint: string | undefined;

  constructor(kind: BuiltinErrorKind, hint?: string) {
    super(`builtin api ${kind}`);
    this.name = 'BuiltinApiError';
    this.kind = kind;
    this.hint = hint;
  }
}

const messages: Record<BuiltinErrorKind, string> = {
  auth_failed: '업스트림이 자격증명을 거부했습니다. 관리 화면에서 계정 연결을 확인하세요.',
  permission_denied:
    '이 계정에 권한이 없거나 API가 꺼져 있습니다. 속성·사이트 권한과 API 사용 설정을 확인하세요.',
  not_found: '대상을 찾을 수 없습니다. ID나 주소를 확인하세요.',
  invalid_argument: '인자가 올바르지 않습니다.',
  rate_limited: '업스트림 호출 한도를 넘었습니다. 잠시 후 다시 시도하세요.',
  timeout: '업스트림 응답이 너무 늦습니다. 잠시 후 다시 시도하세요.',
  unreachable: '업스트림에 연결하지 못했습니다. 잠시 후 다시 시도하세요.',
  upstream_error: '업스트림이 요청을 처리하지 못했습니다.',
};

export function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

export function apiErrorResult(error: BuiltinApiError): CallToolResult {
  const message = messages[error.kind];
  return errorResult(error.hint ? `${message} ${error.hint}` : message);
}

export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}
