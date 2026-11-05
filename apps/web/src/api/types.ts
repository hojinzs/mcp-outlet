// gateway 관리 API 응답 모양 (README "관리 API"). 비밀값은 내려오지 않는다

export type Role = 'user' | 'admin';

export type Me = { id: string; email: string | null; role: Role; groups: string[] };

export type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type Tool = {
  name: string;
  title?: string;
  description?: string;
  annotations?: ToolAnnotations;
};

export type ConnectorRuntime = 'remote' | 'builtin' | 'stdio';

export type ConnectionTestFailure =
  | 'private_address'
  | 'unreachable'
  | 'auth_failed'
  | 'not_mcp'
  | 'timeout'
  | 'redirect'
  // 내장 서비스만: 계정에 속성·사이트 권한이 없거나 API가 꺼짐 / 업스트림 오류
  | 'permission_denied'
  | 'upstream_error';

export type ConnectionTestResult = 'ok' | ConnectionTestFailure;

export type ConnectionTestResponse =
  | { result: 'ok'; tools: Tool[] }
  | { result: ConnectionTestFailure };

// 한 행에 하나만 표시한다 (SCR-EP-01 상태 규칙)
export type EndpointStatus =
  | 'disabled'
  | 'reauth_required'
  | 'connector_error'
  | 'inactive'
  | 'active';

export type EndpointSummary = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  status: EndpointStatus;
  connector: {
    id: string;
    name: string;
    runtime: ConnectorRuntime;
    url: string | null;
    // 내장 서비스 key. /api/builtins에서 서비스 이름을 찾는다
    builtin: string | null;
    // 관리자가 사용 중지한 사유 (status가 disabled일 때)
    disabledReason: string | null;
  };
  toolCounts: { allowed: number; total: number; new: number };
  lastCalledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EndpointTool = Tool & { allowed: boolean; isNew: boolean };

export type EndpointDetail = EndpointSummary & {
  allowedTools: string[];
  tools: EndpointTool[];
  missingTools: string[];
  connectorEndpointCount: number;
};

export type ConnectorStatus = 'pending' | 'ok' | 'error' | 'reauth_required';

export type ConnectorAuthView =
  | { type: 'none' }
  | { type: 'static_token'; header: string; prefix: string }
  | { type: 'oauth2' }
  | { type: 'service_account' };

export type Connector = {
  id: string;
  name: string;
  runtime: ConnectorRuntime;
  url: string | null;
  // 내장 서비스 key (GET /api/builtins). 원격이면 null
  builtin: string | null;
  auth: ConnectorAuthView;
  // account: 연결된 Google 계정 이메일이나 서비스 계정 client_email. 비밀값이 아니다
  credential: { configured: boolean; updatedAt: string | null; account: string | null };
  status: ConnectorStatus;
  disabledAt: string | null;
  disabledReason: string | null;
  lastTestedAt: string | null;
  lastTestResult: ConnectionTestResult | null;
  toolCount: number;
  toolsCachedAt: string | null;
  endpointCount: number;
  lastCalledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CallResult = 'ok' | 'error' | 'denied';

export type RecentCall = {
  at: string;
  toolName: string;
  result: CallResult;
  durationMs: number;
};

export type ConnectInfo = { url: string; clientId: string; hasClientSecret: boolean };

export type RemoteAuthInput =
  | { type: 'none' }
  | { type: 'static_token'; token: string; header: string; prefix: string };

export type RemoteConnectorInput = { name: string; url: string; auth: RemoteAuthInput };

// 토큰을 빼면 저장된 토큰을 그대로 쓴다
export type RemoteConnectorPatch = {
  name?: string;
  url?: string;
  auth?:
    | { type: 'none' }
    | { type: 'static_token'; token?: string; header: string; prefix: string };
};

// 내장 서비스 카드와 접속 방식. authMethods 순서가 화면 탭 순서다 (SCR-EP-02)
export type BuiltinAuthMethod =
  | { type: 'service_account' }
  | { type: 'oauth2'; provider: string; redirectUri: string };

export type Builtin = {
  key: string;
  name: string;
  description: string;
  toolCount: number;
  authMethods: BuiltinAuthMethod[];
};

// key는 서비스 계정 JSON 키 원문. 저장 전 테스트나 엔드포인트와 함께 저장할 때만 보낸다
export type ServiceAccountConnectorInput = {
  builtin: string;
  name: string;
  auth: { type: 'service_account'; key: string };
};

export type NewConnectorInput = RemoteConnectorInput | ServiceAccountConnectorInput;

export type OAuthClient = { clientId: string; clientSecret: string };

// 계정 연결 전에 "연결 중"으로 먼저 저장한다 (SCR-EP-02 계정 연결 순서)
export type OAuthConnectorInput = {
  builtin: string;
  name: string;
  auth: { type: 'oauth2' } & OAuthClient;
};

// returnTo는 /admin/ 으로 시작하는 경로. client를 주면 동의 뒤 그 OAuth 앱으로 바꾼다
export type OAuthStartInput = { returnTo?: string; client?: OAuthClient };

// 내장 커넥터는 이름과 서비스 계정 키만 바꾼다. 키를 바꾸면 연결 테스트를 통과해야 저장된다
export type BuiltinConnectorPatch = {
  name?: string;
  auth?: { type: 'service_account'; key: string };
};

export type EndpointPatch = {
  name?: string;
  allowedTools?: string[];
  enabled?: boolean;
  acknowledgeNewTools?: true;
};

export type CreateEndpointInput = { name: string; allowedTools: string[] } & (
  | { connectorId: string }
  | { connector: NewConnectorInput }
);

// 관리자 화면 (SCR-ADM-04·06). 자격증명·연결 계정은 관리자에게도 내려오지 않는다

export type AdminUser = {
  id: string;
  sub: string;
  email: string | null;
  role: Role;
  // 마지막 로그인·MCP 요청 때 받은 IdP 그룹
  groups: string[];
  lastLoginAt: string | null;
  connectorCount: number;
  disabledConnectorCount: number;
  endpointCount: number;
  lastCalledAt: string | null;
};

export type AdminConnector = {
  id: string;
  name: string;
  runtime: ConnectorRuntime;
  builtin: string | null;
  // 쿼리 값과 사용자 정보는 gateway가 가려서 준다
  url: string | null;
  status: ConnectorStatus;
  disabled: {
    at: string;
    reason: string | null;
    // 중지한 관리자. 그 계정이 지워졌으면 null
    by: { id: string; email: string | null; sub: string | null } | null;
  } | null;
  endpointCount: number;
  lastCalledAt: string | null;
  createdAt: string;
};

export type AdminEndpointOption = { id: string; name: string; connectorId: string };

export type ConnectorDisableInput = { disabled: true; reason: string } | { disabled: false };

// 지워진 사용자·엔드포인트·커넥터는 null
export type AuditEntry = {
  id: number;
  at: string;
  user: { id: string; email: string | null; sub: string | null } | null;
  endpoint: { id: string; name: string | null } | null;
  connector: { id: string; name: string | null } | null;
  toolName: string;
  result: CallResult;
  durationMs: number;
};

export type AuditPage = { entries: AuditEntry[]; nextCursor: string | null };

export type AuditSummary = {
  total: number;
  errors: number;
  denied: number;
  durationMs: { p50: number | null; p95: number | null };
  // 0이면 지우지 않는다
  retentionDays: number;
};
