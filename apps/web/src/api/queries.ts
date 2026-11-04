import { queryOptions } from '@tanstack/react-query';
import { api } from './client.ts';
import type {
  ConnectInfo,
  ConnectionTestResponse,
  Connector,
  CreateEndpointInput,
  EndpointDetail,
  EndpointPatch,
  EndpointSummary,
  Me,
  RecentCall,
  RemoteConnectorInput,
  RemoteConnectorPatch,
  Tool,
} from './types.ts';

// 화면이 쓰는 조회와 변경. 화면은 경로 문자열을 직접 다루지 않는다

export const queryKeys = {
  me: ['me'] as const,
  endpoints: ['endpoints'] as const,
  endpoint: (id: string) => ['endpoints', id] as const,
  calls: (id: string) => ['endpoints', id, 'calls'] as const,
  connectInfo: (id: string) => ['endpoints', id, 'connect-info'] as const,
  connectors: ['connectors'] as const,
  connector: (id: string) => ['connectors', id] as const,
  connectorTools: (id: string) => ['connectors', id, 'tools'] as const,
};

export const meQuery = queryOptions({
  queryKey: queryKeys.me,
  queryFn: () => api<Me>('/api/me'),
  staleTime: 5 * 60_000,
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

export const requests = {
  logout: (idp: boolean) =>
    api<{ redirectTo: string }>(`/auth/logout${idp ? '?idp=true' : ''}`, { method: 'POST' }),
  testUnsavedConnector: (input: RemoteConnectorInput) =>
    api<ConnectionTestResponse>('/api/connectors/test', { method: 'POST', body: input }),
  retestConnector: (id: string) =>
    api<ConnectionTestResponse>(`/api/connectors/${id}/test`, { method: 'POST' }),
  updateConnector: (id: string, patch: RemoteConnectorPatch) =>
    api<Connector>(`/api/connectors/${id}`, { method: 'PATCH', body: patch }),
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
};
