import { ApiError } from '../../api/client.ts';
import type {
  Builtin,
  BuiltinAuthMethod,
  ConnectionTestFailure,
  Connector,
  ConnectorRuntime,
} from '../../api/types.ts';
import { connectionTestMessage } from './remote-form.ts';

// 내장 서비스 커넥터 공통 규칙 (SCR-EP-02 내장 서비스, SCR-EP-03 커넥터 설정)

export type ServiceAccountKeyCheck =
  | { status: 'empty' }
  | { status: 'invalid'; problem: string }
  | { status: 'ok'; clientEmail: string };

// 서비스 계정 JSON 키 형식만 본다. 화면에는 client_email만 꺼내고 private key는 돌려주지 않는다
export function checkServiceAccountKey(text: string): ServiceAccountKeyCheck {
  if (text.trim() === '') return { status: 'empty' };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      status: 'invalid',
      problem: 'JSON 형식이 아닙니다. 내려받은 키 파일 내용을 그대로 넣으세요',
    };
  }
  if (typeof value !== 'object' || value === null) {
    return { status: 'invalid', problem: '서비스 계정 JSON 키가 아닙니다' };
  }
  const key = value as Record<string, unknown>;
  if (key.type !== 'service_account') {
    return {
      status: 'invalid',
      problem: '서비스 계정 키가 아닙니다. Google Cloud 콘솔에서 서비스 계정의 JSON 키를 만드세요',
    };
  }
  if (typeof key.client_email !== 'string' || !key.client_email.includes('@')) {
    return { status: 'invalid', problem: '키에 client_email이 없습니다' };
  }
  if (typeof key.private_key !== 'string' || !key.private_key.includes('PRIVATE KEY')) {
    return { status: 'invalid', problem: '키에 private_key가 없습니다' };
  }
  return { status: 'ok', clientEmail: key.client_email };
}

// 내장 서비스는 주소를 사용자가 넣지 않으므로 원격 문구 일부를 바꾼다.
// private_address·redirect·not_mcp는 내장에서 나오지 않는다
const builtinTestMessages: Partial<Record<ConnectionTestFailure, string>> = {
  auth_failed: 'Google이 자격증명을 거부했습니다. 서비스 계정 키나 OAuth 앱 정보를 확인하세요',
  unreachable: '서비스에 연결하지 못했습니다. 잠시 후 다시 시도하세요',
  permission_denied:
    '계정에 GA 속성·Search Console 사이트 권한이 없거나 API가 꺼져 있습니다. 권한과 Google Cloud 콘솔의 API 사용 설정을 확인하세요',
};

export function connectorTestMessage(runtime: ConnectorRuntime, result: string): string {
  if (runtime === 'builtin') {
    const message = builtinTestMessages[result as ConnectionTestFailure];
    if (message) return message;
  }
  return connectionTestMessage(result);
}

// 업스트림 동의 뒤 gateway가 returnTo에 붙여 돌려보내는 결과
export type ConnectOutcome = 'connected' | 'cancelled' | 'failed' | 'test_failed';

export function connectOutcome(params: URLSearchParams): ConnectOutcome | null {
  if (params.get('connected') === '1') return 'connected';
  const error = params.get('connect_error');
  if (error === null) return null;
  if (error === 'cancelled' || error === 'test_failed') return error;
  return 'failed';
}

export const connectErrorMessages: Record<Exclude<ConnectOutcome, 'connected'>, string> = {
  cancelled: '계정 연결을 취소했습니다',
  failed: '계정 연결에 실패했습니다. Client ID·Secret과 리디렉션 URI를 확인하세요',
  // 재연결(SCR-EP-03): 토큰은 받았지만 tools/list가 실패해 커넥터가 오류 상태로 남음
  test_failed: '계정은 연결했지만 연결 테스트에 실패했습니다. 연결한 계정의 권한을 확인하세요',
};

// 새로고침해도 결과를 다시 처리하지 않게 쿼리에서 지운다
export function withoutConnectOutcome(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('connected');
  next.delete('connect_error');
  return next;
}

// gateway는 /admin/ 으로 시작하는 경로만 returnTo로 받는다 (vite.config.ts base)
export const newEndpointReturnTo = (connectorId: string) =>
  `/admin/endpoints/new?connector=${encodeURIComponent(connectorId)}`;
export const endpointReturnTo = (endpointId: string) =>
  `/admin/endpoints/${encodeURIComponent(endpointId)}`;

export function builtinNameOf(
  builtins: readonly Builtin[] | undefined,
  key: string | null,
): string | null {
  if (key === null) return null;
  return builtins?.find((builtin) => builtin.key === key)?.name ?? null;
}

export function authMethodLabel(method: BuiltinAuthMethod): string {
  return method.type === 'service_account' ? '서비스 계정' : `${method.provider} 계정 연결`;
}

export function oauthMethodOf(builtin: Builtin | undefined) {
  return builtin?.authMethods.find(
    (method): method is Extract<BuiltinAuthMethod, { type: 'oauth2' }> => method.type === 'oauth2',
  );
}

export function supportsServiceAccount(builtin: Builtin | undefined): boolean {
  return builtin?.authMethods.some((method) => method.type === 'service_account') ?? false;
}

// "연결 중"(계정 연결 전) 커넥터는 연결 테스트를 거쳐야 쓸 수 있다
export function isPickable(connector: Connector): boolean {
  return connector.disabledAt === null && connector.status !== 'pending';
}

// 서비스별 권한·API 안내. /api/builtins가 주지 않아 화면이 key로 고른다
type BuiltinGuide = { serviceAccount: string; oauthApis: string };

const builtinGuides: Record<string, BuiltinGuide> = {
  'google-analytics': {
    serviceAccount:
      '이 서비스 계정 이메일을 GA4 속성(관리 > 속성 액세스 관리, 뷰어)과 Search Console 사이트(설정 > 사용자 및 권한)에 추가하세요.',
    oauthApis: 'Analytics Data API·Analytics Admin API·Search Console API',
  },
};

const defaultGuide: BuiltinGuide = {
  serviceAccount: '이 서비스 계정 이메일에 서비스의 보기 권한을 주세요.',
  oauthApis: '이 서비스가 쓰는 API',
};

export function builtinGuide(key: string | null): BuiltinGuide {
  return (key && builtinGuides[key]) || defaultGuide;
}

// 계정 연결 시작·서비스 계정 키 저장 실패 문구. 서버 원문 예외는 보여주지 않는다
export function builtinErrorText(error: Error): string {
  if (!(error instanceof ApiError)) return error.message;
  if (error.code === 'connection_test_failed') {
    return connectorTestMessage('builtin', String(error.details?.result ?? ''));
  }
  if (error.status === 400) {
    const field = error.details?.field;
    if (field === 'key') return '서비스 계정 JSON 키 형식이 맞지 않습니다';
    if (field === 'clientId' || field === 'clientSecret') {
      return 'Client ID와 Client Secret을 넣으세요';
    }
    return '입력값을 확인하세요';
  }
  return error.message;
}
