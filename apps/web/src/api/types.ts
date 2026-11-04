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
  | 'redirect';

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
  connector: { id: string; name: string; runtime: ConnectorRuntime; url: string | null };
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
  | { type: 'static_token'; header: string; prefix: string };

export type Connector = {
  id: string;
  name: string;
  runtime: ConnectorRuntime;
  url: string | null;
  auth: ConnectorAuthView;
  credential: { configured: boolean; updatedAt: string | null };
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

export type EndpointPatch = {
  name?: string;
  allowedTools?: string[];
  enabled?: boolean;
  acknowledgeNewTools?: true;
};

export type CreateEndpointInput = { name: string; allowedTools: string[] } & (
  | { connectorId: string }
  | { connector: RemoteConnectorInput }
);
