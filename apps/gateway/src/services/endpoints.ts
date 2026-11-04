import { listRecentCalls } from '../db/queries/audit-logs.ts';
import type { ConnectorRow } from '../db/queries/connectors.ts';
import { deleteConnector, findConnector } from '../db/queries/connectors.ts';
import {
  countConnectorEndpoints,
  countEndpoints,
  deleteEndpoint as deleteEndpointRow,
  type EndpointRow,
  findEndpoint,
  insertEndpoint,
  listEndpoints as listEndpointRows,
  updateEndpoint as updateEndpointRow,
} from '../db/queries/endpoints.ts';
import { endpointUrl } from '../mcp/urls.ts';
import type { CachedTool } from '../runtimes/types.ts';
import {
  assertConnectorQuota,
  type ConnectorServiceDeps,
  type NewConnectorInput,
  registerTestedConnector,
} from './connectors.ts';
import { ServiceError } from './errors.ts';

// 엔드포인트: 커넥터 하나에서 툴을 추린 URL (F-EP-01·02·04, SCR-EP-01~04)

export type EndpointServiceDeps = ConnectorServiceDeps & {
  maxEndpointsPerUser: number;
  publicBaseUrl: string;
};

export const RECENT_CALLS_LIMIT = 20;

// 한 행에 하나만 표시한다. 위에 있는 것이 먼저다 (SCR-EP-01 상태 규칙)
export type EndpointStatus =
  | 'disabled'
  | 'reauth_required'
  | 'connector_error'
  | 'inactive'
  | 'active';

export function endpointStatus(endpoint: EndpointRow, connector: ConnectorRow): EndpointStatus {
  if (connector.disabledAt) return 'disabled';
  if (connector.status === 'reauth_required') return 'reauth_required';
  if (connector.status === 'error') return 'connector_error';
  if (!endpoint.enabled) return 'inactive';
  return 'active';
}

const toolNames = (tools: readonly CachedTool[]) => tools.map((tool) => tool.name);

// 새 툴 = 현재 커넥터 툴 − knownTools (SCR-EP-03 결정 사항)
function toolCounts(endpoint: EndpointRow, connector: ConnectorRow) {
  const current = connector.toolsCache ?? [];
  const allowed = new Set(endpoint.allowedTools);
  const known = new Set(endpoint.knownTools);
  return {
    allowed: current.filter((tool) => allowed.has(tool.name)).length,
    total: current.length,
    new: current.filter((tool) => !known.has(tool.name)).length,
  };
}

function endpointSummary(
  deps: Pick<EndpointServiceDeps, 'publicBaseUrl'>,
  { endpoint, connector }: { endpoint: EndpointRow; connector: ConnectorRow },
) {
  const manifest = connector.manifest;
  return {
    id: endpoint.id,
    name: endpoint.name,
    url: endpointUrl(deps.publicBaseUrl, endpoint.id),
    enabled: endpoint.enabled,
    status: endpointStatus(endpoint, connector),
    connector: {
      id: connector.id,
      name: manifest.name,
      runtime: connector.runtime,
      url: manifest.runtime === 'remote' ? manifest.url : null,
    },
    toolCounts: toolCounts(endpoint, connector),
    lastCalledAt: endpoint.lastCalledAt,
    createdAt: endpoint.createdAt,
    updatedAt: endpoint.updatedAt,
  };
}

export async function listEndpoints(
  deps: Pick<EndpointServiceDeps, 'db' | 'publicBaseUrl'>,
  ownerId: string,
) {
  const rows = await listEndpointRows(deps.db, ownerId);
  return rows.map((row) => endpointSummary(deps, row));
}

async function requireEndpoint(deps: Pick<EndpointServiceDeps, 'db'>, ownerId: string, id: string) {
  const row = await findEndpoint(deps.db, ownerId, id);
  // 다른 사람의 엔드포인트도 없는 것과 똑같이 다룬다 (F-AUTH-05)
  if (!row) throw new ServiceError('not_found');
  return row;
}

// 커넥터 툴마다 허용 여부와 새 툴 여부, 그리고 허용목록에 있지만 커넥터에서 사라진 툴 (SCR-EP-03)
export async function getEndpoint(
  deps: Pick<EndpointServiceDeps, 'db' | 'publicBaseUrl'>,
  ownerId: string,
  id: string,
) {
  const row = await requireEndpoint(deps, ownerId, id);
  const { endpoint, connector } = row;
  const current = connector.toolsCache ?? [];
  const names = new Set(toolNames(current));
  const allowed = new Set(endpoint.allowedTools);
  const known = new Set(endpoint.knownTools);
  return {
    ...endpointSummary(deps, row),
    allowedTools: endpoint.allowedTools,
    tools: current.map((tool) => ({
      ...tool,
      allowed: allowed.has(tool.name),
      isNew: !known.has(tool.name),
    })),
    missingTools: endpoint.allowedTools.filter((name) => !names.has(name)),
    connectorEndpointCount: await countConnectorEndpoints(deps.db, connector.id),
  };
}

async function assertEndpointQuota(
  deps: Pick<EndpointServiceDeps, 'db' | 'maxEndpointsPerUser'>,
  ownerId: string,
): Promise<void> {
  const count = await countEndpoints(deps.db, ownerId);
  if (count >= deps.maxEndpointsPerUser) {
    throw new ServiceError('limit_exceeded', {
      resource: 'endpoint',
      limit: deps.maxEndpointsPerUser,
    });
  }
}

// 화면이 본 툴 목록과 저장 시점 목록이 다르면 거부한다 (SCR-EP-02 오류)
function assertToolsAvailable(requested: readonly string[], available: readonly string[]): void {
  const names = new Set(available);
  if (requested.some((name) => !names.has(name))) throw new ServiceError('tools_changed');
}

export type CreateEndpointInput = { name: string; allowedTools: string[] } & (
  | { connectorId: string; connector?: undefined }
  | { connector: NewConnectorInput; connectorId?: undefined }
);

// 새 커넥터면 연결 테스트를 통과한 뒤 커넥터·자격증명·엔드포인트를 한 번에 저장한다 (SCR-EP-02)
export async function createEndpoint(
  deps: EndpointServiceDeps,
  ownerId: string,
  input: CreateEndpointInput,
) {
  await assertEndpointQuota(deps, ownerId);
  const allowedTools = [...new Set(input.allowedTools)];

  if (input.connector) {
    await assertConnectorQuota(deps, ownerId);
    const registered = await registerTestedConnector(deps, input.connector);
    const knownTools = toolNames(registered.tools);
    assertToolsAvailable(allowedTools, knownTools);
    const endpoint = await deps.db.transaction(async (tx) => {
      const connector = await registered.save(tx, ownerId);
      return insertEndpoint(tx, {
        ownerId,
        connectorId: connector.id,
        name: input.name,
        allowedTools,
        knownTools,
      });
    });
    return getEndpoint(deps, ownerId, endpoint.id);
  }

  const existing = await findConnector(deps.db, ownerId, input.connectorId);
  if (!existing) throw new ServiceError('not_found');
  const knownTools = toolNames(existing.connector.toolsCache ?? []);
  assertToolsAvailable(allowedTools, knownTools);
  const endpoint = await insertEndpoint(deps.db, {
    ownerId,
    connectorId: existing.connector.id,
    name: input.name,
    allowedTools,
    knownTools,
  });
  return getEndpoint(deps, ownerId, endpoint.id);
}

export type EndpointPatch = {
  name?: string | undefined;
  allowedTools?: string[] | undefined;
  enabled?: boolean | undefined;
  // 새 툴을 허용하지 않고 배지만 없앤다 (SCR-EP-03 "새 툴 확인함")
  acknowledgeNewTools?: boolean | undefined;
};

export async function updateEndpoint(
  deps: Pick<EndpointServiceDeps, 'db' | 'publicBaseUrl'>,
  ownerId: string,
  id: string,
  patch: EndpointPatch,
) {
  const { endpoint, connector } = await requireEndpoint(deps, ownerId, id);
  const currentNames = toolNames(connector.toolsCache ?? []);
  const allowedTools = patch.allowedTools ? [...new Set(patch.allowedTools)] : undefined;
  // 커넥터에서 사라진 툴은 허용목록에 남겨 둘 수 있다
  if (allowedTools) assertToolsAvailable(allowedTools, [...currentNames, ...endpoint.allowedTools]);
  const refreshKnown = allowedTools !== undefined || patch.acknowledgeNewTools === true;

  await updateEndpointRow(deps.db, ownerId, id, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(allowedTools ? { allowedTools } : {}),
    ...(refreshKnown ? { knownTools: currentNames } : {}),
  });
  return getEndpoint(deps, ownerId, id);
}

// deleteConnector면 이 커넥터를 쓰는 마지막 엔드포인트일 때 커넥터·자격증명도 지운다 (SCR-EP-03 삭제)
export async function deleteEndpoint(
  deps: Pick<EndpointServiceDeps, 'db'>,
  ownerId: string,
  id: string,
  options: { deleteConnector: boolean },
): Promise<{ connectorDeleted: boolean }> {
  return deps.db.transaction(async (tx) => {
    const row = await findEndpoint(tx, ownerId, id);
    if (!row) throw new ServiceError('not_found');
    await deleteEndpointRow(tx, ownerId, id);
    const connectorId = row.connector.id;
    if (!options.deleteConnector || (await countConnectorEndpoints(tx, connectorId)) > 0) {
      return { connectorDeleted: false };
    }
    await deleteConnector(tx, ownerId, connectorId);
    return { connectorDeleted: true };
  });
}

// 최근 호출 20건 (SCR-EP-03). 감사 로그에서 본인 엔드포인트 것만
export async function listEndpointCalls(
  deps: Pick<EndpointServiceDeps, 'db'>,
  ownerId: string,
  id: string,
) {
  await requireEndpoint(deps, ownerId, id);
  return listRecentCalls(deps.db, id, RECENT_CALLS_LIMIT);
}

// 연결 안내 값 (SCR-EP-04). Client Secret 값은 따로 요청할 때만 준다
export async function getConnectInfo(
  deps: Pick<EndpointServiceDeps, 'db' | 'publicBaseUrl'>,
  ownerId: string,
  id: string,
  client: { clientId: string; hasClientSecret: boolean },
) {
  await requireEndpoint(deps, ownerId, id);
  return { url: endpointUrl(deps.publicBaseUrl, id), ...client };
}
