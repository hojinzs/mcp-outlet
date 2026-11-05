import { ApiError } from '../../api/client.ts';
import type {
  Builtin,
  BuiltinAuthMethod,
  ConnectionTestFailure,
  ConnectionTestResponse,
  Connector,
  ConnectorRuntime,
} from '../../api/types.ts';
import { limitExceededText } from '../endpoints/limit.ts';
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
export type ConnectOutcome = 'connected' | 'cancelled' | 'failed' | 'test_failed' | 'expired';

export function connectOutcome(params: URLSearchParams): ConnectOutcome | null {
  if (params.get('connected') === '1') return 'connected';
  const error = params.get('connect_error');
  if (error === null) return null;
  if (error === 'cancelled' || error === 'test_failed' || error === 'expired') return error;
  return 'failed';
}

// gateway의 업스트림 state 쿠키 수명(UPSTREAM_STATE_TTL_MS)
const CONNECT_TIME_LIMIT = '10분';

export const connectErrorMessages: Record<Exclude<ConnectOutcome, 'connected'>, string> = {
  cancelled: '계정 연결을 취소했습니다',
  failed: '계정 연결에 실패했습니다. Client ID·Secret과 리디렉션 URI를 확인하세요',
  // 재연결(SCR-EP-03): 토큰은 받았지만 tools/list가 실패해 커넥터가 오류 상태로 남음
  test_failed: '계정은 연결했지만 연결 테스트에 실패했습니다. 연결한 계정의 권한을 확인하세요',
  expired: `계정 연결 시간(${CONNECT_TIME_LIMIT})이 지나 연결을 마치지 못했습니다. 다시 연결하세요`,
};

// 홈(SCR-EP-01)에 온 연결 결과 안내. state 쿠키가 만료(expired)되었거나 맞지 않으면 gateway는
// 돌아갈 화면을 몰라 홈으로 보낸다. 어느 커넥터인지 모르므로 다시 연결할 곳을 함께 알린다
export function homeConnectNotice(outcome: ConnectOutcome | null): string | null {
  if (outcome === null || outcome === 'connected') return null;
  const retry = '엔드포인트 상세나 추가 화면에서 다시 연결하세요';
  if (outcome === 'expired') {
    return `계정 연결 시간(${CONNECT_TIME_LIMIT})이 지나 연결을 마치지 못했습니다. ${retry}`;
  }
  return `계정 연결을 마치지 못했습니다. ${retry}`;
}

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

// 정상(ok) 커넥터만 고를 수 있다. 연결 중·오류·재연결 필요는 다시 연결·연결 테스트로 고친 뒤 쓴다
// (SCR-EP-02 결정 사항)
export function isPickable(connector: Connector): boolean {
  return unpickableReason(connector) === null;
}

export type UnpickableGuide = { reason: string; link: { to: string; label: string } | null };

const unpickableReasons: Record<Exclude<Connector['status'], 'ok'>, string> = {
  pending: '계정 연결을 마치지 않았습니다',
  error: '마지막 연결 테스트나 호출에서 인증·연결에 실패했습니다',
  reauth_required: '계정 연결이 만료되었거나 취소되었습니다',
};

// 서비스 계정 키가 거부된 커넥터(키 폐기·손상). 고치려면 키 파일을 교체해야 한다.
// gateway는 키 거부를 error와 연결 테스트 auth_failed로 남긴다. 그 전에는 reauth_required로 남겼으므로
// 서비스 계정의 reauth_required도 키 거부로 본다. MCP 호출 중 거부는 lastTestResult를 바꾸지 않아
// 연결 테스트를 다시 해야 여기에 걸린다
export function serviceAccountKeyRejected(
  connector: Pick<Connector, 'auth' | 'status' | 'lastTestResult'>,
): boolean {
  if (connector.auth.type !== 'service_account') return false;
  if (connector.status === 'reauth_required') return true;
  return connector.status === 'error' && connector.lastTestResult === 'auth_failed';
}

// 고를 수 없는 사유. 고를 수 있으면 null
export function unpickableReason(connector: Connector): string | null {
  if (connector.disabledAt !== null) return '관리자가 사용 중지한 커넥터입니다';
  if (connector.status === 'ok') return null;
  if (serviceAccountKeyRejected(connector)) return '서비스 계정 키가 거부되었습니다';
  return unpickableReasons[connector.status];
}

function detailFixLabel(connector: Connector): string {
  if (serviceAccountKeyRejected(connector)) return '상세에서 키 교체';
  if (connector.status === 'reauth_required') return '상세에서 다시 연결';
  return '상세에서 다시 테스트';
}

// 이어하기 화면의 상태 사유. 이 화면에서 한 연결 테스트가 성공했으면 테스트 전 사유를 지운다.
// 커넥터는 테스트 뒤 다시 받은 것을 넘긴다 (SCR-EP-02)
export function resumeReason(
  connector: Connector,
  latestTest: ConnectionTestResponse['result'] | undefined,
): string | null {
  if (connector.disabledAt === null && latestTest === 'ok') return null;
  return unpickableReason(connector);
}

// 엔드포인트 추가의 이어하기 화면. 정상이 아니면 다시 연결·연결 테스트부터, 정상이면 툴 선택으로 간다
export function resumeLink(connectorId: string): string {
  return `/endpoints/new?connector=${encodeURIComponent(connectorId)}`;
}

// 고를 수 없는 커넥터의 사유와 고칠 곳. 엔드포인트가 있으면 그 상세(재테스트·재연결)로,
// 없으면 이어하기 화면으로 보낸다 (SCR-EP-02, SCR-EP-01).
// endpointIds(커넥터 id → 엔드포인트 하나)를 아직 받지 못했으면 상세 링크를 그리지 않는다
export function unpickableGuide(
  connector: Connector,
  endpointIds: ReadonlyMap<string, string> | undefined,
): UnpickableGuide | null {
  const reason = unpickableReason(connector);
  if (reason === null) return null;
  // 관리자 사용 중지는 사용자가 고칠 수 없다
  if (connector.disabledAt !== null) return { reason, link: null };
  if (connector.endpointCount === 0) {
    // 서비스 계정은 다시 연결이 없고 이어하기 화면에서 키 파일을 교체한다
    const label =
      connector.auth.type === 'service_account' ? '키 교체·연결 테스트' : '다시 연결·연결 테스트';
    return { reason, link: { to: resumeLink(connector.id), label } };
  }
  const endpointId = endpointIds?.get(connector.id);
  if (endpointId === undefined) return { reason, link: null };
  return {
    reason,
    link: { to: `/endpoints/${encodeURIComponent(endpointId)}`, label: detailFixLabel(connector) },
  };
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
  // 계정 연결 시작(POST /api/connectors)은 커넥터를 먼저 만들어 커넥터 상한에 걸릴 수 있다
  const limit = limitExceededText(error);
  if (limit) return limit;
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
