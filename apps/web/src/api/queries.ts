import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from './client.ts';
import type {
  AdminConnector,
  AdminEndpointOption,
  AdminUser,
  AuditPage,
  AuditSummary,
  AuthOptions,
  Builtin,
  BuiltinConnectorPatch,
  ConnectInfo,
  ConnectionTestResponse,
  Connector,
  ConnectorDisableInput,
  CreateEndpointInput,
  EndpointDetail,
  EndpointPatch,
  EndpointSummary,
  Me,
  NewConnectorInput,
  OAuthConnectorInput,
  OAuthStartInput,
  RecentCall,
  RemoteConnectorPatch,
  Tool,
} from './types.ts';

// 화면이 쓰는 조회와 변경. 화면은 경로 문자열을 직접 다루지 않는다

export const queryKeys = {
  me: ['me'] as const,
  authOptions: ['auth-options'] as const,
  endpoints: ['endpoints'] as const,
  endpoint: (id: string) => ['endpoints', id] as const,
  calls: (id: string) => ['endpoints', id, 'calls'] as const,
  connectInfo: (id: string) => ['endpoints', id, 'connect-info'] as const,
  connectors: ['connectors'] as const,
  connector: (id: string) => ['connectors', id] as const,
  connectorTools: (id: string) => ['connectors', id, 'tools'] as const,
  builtins: ['builtins'] as const,
  admin: ['admin'] as const,
  adminUsers: ['admin', 'users'] as const,
  adminUserConnectors: (id: string) => ['admin', 'users', id, 'connectors'] as const,
  adminUserEndpoints: (id: string) => ['admin', 'users', id, 'endpoints'] as const,
  adminAudit: (query: string) => ['admin', 'audit', query] as const,
  adminAuditSummary: (query: string) => ['admin', 'audit', 'summary', query] as const,
};

export const meQuery = queryOptions({
  queryKey: queryKeys.me,
  queryFn: () => api<Me>('/api/me'),
  staleTime: 5 * 60_000,
});

// 세션 없이 받는다. IdP 설정은 실행 중에 바뀌지 않는다
export const authOptionsQuery = queryOptions({
  queryKey: queryKeys.authOptions,
  queryFn: () => api<AuthOptions>('/auth/options'),
  staleTime: Infinity,
});

export const endpointsQuery = queryOptions({
  queryKey: queryKeys.endpoints,
  queryFn: async () => (await api<{ endpoints: EndpointSummary[] }>('/api/endpoints')).endpoints,
});

export const endpointQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.endpoint(id),
    queryFn: () => api<EndpointDetail>(`/api/endpoints/${id}`),
  });

export const callsQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.calls(id),
    queryFn: async () => (await api<{ calls: RecentCall[] }>(`/api/endpoints/${id}/calls`)).calls,
  });

export const connectInfoQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.connectInfo(id),
    queryFn: () => api<ConnectInfo>(`/api/endpoints/${id}/connect-info`),
  });

export const connectorsQuery = queryOptions({
  queryKey: queryKeys.connectors,
  queryFn: async () => (await api<{ connectors: Connector[] }>('/api/connectors')).connectors,
});

export const connectorQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.connector(id),
    queryFn: () => api<Connector>(`/api/connectors/${id}`),
  });

export const connectorToolsQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.connectorTools(id),
    queryFn: async () => (await api<{ tools: Tool[] }>(`/api/connectors/${id}/tools`)).tools,
  });

// 설치에 들어 있는 내장 서비스는 실행 중에 바뀌지 않는다
export const builtinsQuery = queryOptions({
  queryKey: queryKeys.builtins,
  queryFn: async () => (await api<{ builtins: Builtin[] }>('/api/builtins')).builtins,
  staleTime: Number.POSITIVE_INFINITY,
});

// 관리자 화면 (SCR-ADM-04·06). 사용자 목록은 한 번에 받는다
export const adminUsersQuery = queryOptions({
  queryKey: queryKeys.adminUsers,
  queryFn: async () => (await api<{ users: AdminUser[] }>('/api/admin/users')).users,
});

export const adminUserConnectorsQuery = (userId: string) =>
  queryOptions({
    queryKey: queryKeys.adminUserConnectors(userId),
    queryFn: async () =>
      (await api<{ connectors: AdminConnector[] }>(`/api/admin/users/${userId}/connectors`))
        .connectors,
  });

export const adminUserEndpointsQuery = (userId: string) =>
  queryOptions({
    queryKey: queryKeys.adminUserEndpoints(userId),
    queryFn: async () =>
      (await api<{ endpoints: AdminEndpointOption[] }>(`/api/admin/users/${userId}/endpoints`))
        .endpoints,
  });

// query는 features/admin/audit-filter.ts가 만든 쿼리 문자열. 50건씩 커서로 이어 받는다
export const adminAuditQuery = (query: string) =>
  infiniteQueryOptions({
    queryKey: queryKeys.adminAudit(query),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(query);
      if (pageParam) params.set('cursor', pageParam);
      return api<AuditPage>(`/api/admin/audit?${params}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

export const adminAuditSummaryQuery = (query: string) =>
  queryOptions({
    queryKey: queryKeys.adminAuditSummary(query),
    queryFn: () => api<AuditSummary>(`/api/admin/audit/summary?${query}`),
  });

export const requests = {
  logout: (idp: boolean) =>
    api<{ redirectTo: string }>(`/auth/logout${idp ? '?idp=true' : ''}`, { method: 'POST' }),
  testUnsavedConnector: (input: NewConnectorInput) =>
    api<ConnectionTestResponse>('/api/connectors/test', { method: 'POST', body: input }),
  createOAuthConnector: (input: OAuthConnectorInput) =>
    api<Connector>('/api/connectors', { method: 'POST', body: input }),
  // 응답이 state 쿠키를 심는다. 받은 주소로 바로 이동한다
  startConnectorOAuth: (id: string, input: OAuthStartInput) =>
    api<{ authorizationUrl: string }>(`/api/connectors/${id}/oauth/start`, {
      method: 'POST',
      body: input,
    }),
  retestConnector: (id: string) =>
    api<ConnectionTestResponse>(`/api/connectors/${id}/test`, { method: 'POST' }),
  updateConnector: (id: string, patch: RemoteConnectorPatch | BuiltinConnectorPatch) =>
    api<Connector>(`/api/connectors/${id}`, { method: 'PATCH', body: patch }),
  // 커넥터의 엔드포인트·자격증명도 함께 지워진다 (F-CON-04)
  deleteConnector: (id: string) => api<void>(`/api/connectors/${id}`, { method: 'DELETE' }),
  createEndpoint: (input: CreateEndpointInput) =>
    api<EndpointDetail>('/api/endpoints', { method: 'POST', body: input }),
  updateEndpoint: (id: string, patch: EndpointPatch) =>
    api<EndpointDetail>(`/api/endpoints/${id}`, { method: 'PATCH', body: patch }),
  deleteEndpoint: (id: string, deleteConnector: boolean) =>
    api<{ connectorDeleted: boolean }>(`/api/endpoints/${id}?deleteConnector=${deleteConnector}`, {
      method: 'DELETE',
    }),
  // 볼 때마다 gateway가 작업 기록을 남긴다 (SCR-EP-04)
  connectSecret: () => api<{ clientSecret: string }>('/api/connect-secret'),
  // 사용 중지·다시 사용은 gateway가 작업 기록에 남긴다 (SCR-ADM-04)
  setConnectorDisabled: (id: string, input: ConnectorDisableInput) =>
    api<AdminConnector>(`/api/admin/connectors/${id}`, { method: 'PATCH', body: input }),
};
