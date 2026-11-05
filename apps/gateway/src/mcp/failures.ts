import type { UpstreamErrorKind } from '../upstream/safe-fetch.ts';

// 업스트림 실패를 클라이언트에 알리는 고정 문구 (F-RUN-03). 원격 프록시와 내장 런타임이 함께 쓴다.
// 업스트림 원문은 넣지 않고, 사용자가 고칠 수 있는 문제면 관리 화면 링크를 붙인다

export type FailureKind =
  | UpstreamErrorKind
  | 'auth_failed'
  | 'reauth_required'
  | 'key_rejected'
  | 'upstream_error';

export function failureMessage(kind: FailureKind, adminUrl: string): string {
  const fix = `관리 화면에서 커넥터 설정을 확인하세요: ${adminUrl}`;
  switch (kind) {
    case 'auth_failed':
      return `커넥터가 업스트림 인증에 실패했습니다. ${fix}`;
    case 'reauth_required':
      return `커넥터의 계정 연결이 만료되었거나 취소되었습니다. 관리 화면에서 다시 연결하세요: ${adminUrl}`;
    case 'key_rejected':
      return `서비스 계정 키가 거부되었습니다. 관리 화면에서 키 파일을 교체하세요: ${adminUrl}`;
    case 'blocked_address':
    case 'insecure_scheme':
      return `커넥터 주소가 허용되지 않는 주소입니다. ${fix}`;
    case 'redirect':
      return `커넥터가 다른 주소로 보냈습니다. ${fix}`;
    case 'timeout':
      return '커넥터 응답이 너무 늦습니다. 잠시 후 다시 시도하세요.';
    case 'unreachable':
      return `커넥터에 연결하지 못했습니다. ${fix}`;
    case 'upstream_error':
      return '커넥터가 요청을 처리하지 못했습니다.';
  }
}

// tools/call 실패는 JSON-RPC 오류가 아니라 툴 결과로 준다. 클라이언트가 JSON-RPC 오류를 일반 문구로
// 바꿔 보여주면 관리 화면 링크가 사용자에게 닿지 않아서다 (F-RUN-03 툴 호출 실패 형식)
export function toolFailureResult(kind: FailureKind, adminUrl: string) {
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: failureMessage(kind, adminUrl) }],
  };
}
