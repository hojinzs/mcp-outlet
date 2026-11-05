import type { Db } from '../db/client.ts';
import { insertActivityLog } from '../db/queries/activity-logs.ts';
import {
  findConnectorOwner,
  listConnectorsForAdmin,
  setConnectorDisabled,
} from '../db/queries/connectors.ts';
import { listEndpointNames } from '../db/queries/endpoints.ts';
import { findUserById, listUsersWithStats } from '../db/queries/users.ts';
import { ServiceError } from './errors.ts';

// 관리자 사용자 목록과 사용자별 커넥터, 커넥터 사용 중지 (SCR-ADM-04, F-UI-02).
// 관리자 확인은 라우트의 requireAdmin이 매 요청 한다. 자격증명은 읽지도 않는다

export type AdminDeps = { db: Db; now: () => Date };

export type UserListFilter = { query?: string | undefined; disabledOnly?: boolean | undefined };

export async function listUsers(deps: Pick<AdminDeps, 'db'>, filter: UserListFilter) {
  return listUsersWithStats(deps.db, filter);
}

async function requireUser(deps: Pick<AdminDeps, 'db'>, userId: string): Promise<void> {
  if (!(await findUserById(deps.db, userId))) throw new ServiceError('not_found');
}

// 원격 URL은 쿼리 문자열의 값과 사용자 정보(user:pass@)를 가린다. 토큰을 주소에 넣는 서버가 있어서다
export function maskRemoteUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return '';
  }
  if (url.username || url.password) {
    url.username = '***';
    url.password = '';
  }
  const keys = [...url.searchParams.keys()];
  url.search = keys.map((key) => `${encodeURIComponent(key)}=***`).join('&');
  url.hash = '';
  return url.toString();
}

type AdminConnectorRow = Awaited<ReturnType<typeof listConnectorsForAdmin>>[number];

// 어디에 붙었는지까지만 보여준다. 자격증명, 연결된 계정, 툴 허용목록은 담지 않는다
function adminConnectorView({
  connector,
  endpointCount,
  disabledByEmail,
  disabledBySub,
}: AdminConnectorRow) {
  const manifest = connector.manifest;
  return {
    id: connector.id,
    name: manifest.name,
    runtime: connector.runtime,
    builtin: manifest.runtime === 'builtin' ? manifest.builtin : null,
    url: manifest.runtime === 'remote' ? maskRemoteUrl(manifest.url) : null,
    status: connector.status,
    disabled: connector.disabledAt
      ? {
          at: connector.disabledAt,
          reason: connector.disabledReason,
          // 이메일 클레임이 없는 관리자도 있어 sub를 함께 준다
          by: connector.disabledBy
            ? { id: connector.disabledBy, email: disabledByEmail, sub: disabledBySub }
            : null,
        }
      : null,
    endpointCount,
    lastCalledAt: connector.lastCalledAt,
    createdAt: connector.createdAt,
  };
}

export type AdminConnectorView = ReturnType<typeof adminConnectorView>;

export async function listUserConnectors(deps: Pick<AdminDeps, 'db'>, userId: string) {
  await requireUser(deps, userId);
  const rows = await listConnectorsForAdmin(deps.db, userId);
  return rows.map(adminConnectorView);
}

// 감사 로그 필터의 엔드포인트 선택지 (SCR-ADM-06)
export async function listUserEndpoints(deps: Pick<AdminDeps, 'db'>, userId: string) {
  await requireUser(deps, userId);
  return listEndpointNames(deps.db, userId);
}

export type ConnectorDisableInput =
  | { disabled: true; reason: string }
  | { disabled: false; reason?: string | undefined };

// 사용 중지하면 다음 MCP 요청부터 거부한다. 사용자가 설정을 바꿔도 다시 켜지지 않고 관리자가 다시 사용해야 한다.
// 상태가 바뀔 때만 작업 기록(activity_logs)에 누가·어떤 커넥터·사유를 남긴다
export async function setConnectorDisabledByAdmin(
  deps: AdminDeps,
  actorId: string,
  connectorId: string,
  input: ConnectorDisableInput,
): Promise<AdminConnectorView> {
  const target = await findConnectorOwner(deps.db, connectorId);
  // 전역 커넥터는 v2라 v1 관리자 API에서 다루지 않는다
  if (!target?.ownerId) throw new ServiceError('not_found');
  const ownerId = target.ownerId;

  await deps.db.transaction(async (tx) => {
    const disable = input.disabled
      ? { disabledAt: deps.now(), disabledBy: actorId, disabledReason: input.reason }
      : null;
    if (!(await setConnectorDisabled(tx, connectorId, disable))) return;
    await insertActivityLog(tx, {
      actorId,
      action: input.disabled ? 'connector.disable' : 'connector.enable',
      targetType: 'connector',
      targetId: connectorId,
      reason: input.reason ?? null,
    });
  });

  const view = (await listConnectorsForAdmin(deps.db, ownerId))
    .map(adminConnectorView)
    .find((connector) => connector.id === connectorId);
  if (!view) throw new ServiceError('not_found');
  return view;
}
