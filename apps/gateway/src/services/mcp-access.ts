import type { JWTPayload } from 'jose';
import { type AccessPolicy, decideAccess, extractGroups, type Role } from '../auth/access.ts';
import type { Db } from '../db/client.ts';
import type { ConnectorRow } from '../db/queries/connectors.ts';
import { type EndpointRow, findEndpointForMcp } from '../db/queries/endpoints.ts';
import { findUserBySub, updateUserClaims } from '../db/queries/users.ts';

// 검증을 마친 MCP 토큰으로 엔드포인트 호출 권한을 정한다

export type McpAccess =
  | { kind: 'ok'; endpoint: EndpointRow; connector: ConnectorRow }
  // 로그인 허용 그룹에서 빠진 사용자 (F-AUTH-06)
  | { kind: 'not_member' }
  // 없는 엔드포인트와 다른 사람의 엔드포인트를 구분하지 않는다 (F-AUTH-05)
  | { kind: 'not_found' }
  | { kind: 'endpoint_disabled' }
  | { kind: 'connector_disabled' };

export async function resolveMcpAccess(
  db: Db,
  claims: JWTPayload & { sub: string },
  endpointId: string | null,
  policy: AccessPolicy,
): Promise<McpAccess> {
  const groups = extractGroups(claims, policy.groupsClaim);
  const decision = decideAccess(groups, policy);
  await refreshUser(db, claims, groups, decision.allowed ? decision.role : null);
  if (!decision.allowed) return { kind: 'not_member' };

  const row = endpointId ? await findEndpointForMcp(db, endpointId) : undefined;
  if (!row || row.ownerSub !== claims.sub) return { kind: 'not_found' };
  if (row.connector.disabledAt) return { kind: 'connector_disabled' };
  if (!row.endpoint.enabled) return { kind: 'endpoint_disabled' };
  return { kind: 'ok', endpoint: row.endpoint, connector: row.connector };
}

// MCP 요청마다 토큰 클레임으로 email·groups·role을 맞춘다 (F-AUTH-06). 바뀐 값만 쓴다.
// 그룹에서 빠진 경우에도 groups는 맞추고, role은 허용될 때만 다시 정한다. 토큰에 email이 없으면 기존 값을 둔다
async function refreshUser(
  db: Db,
  claims: JWTPayload & { sub: string },
  groups: string[],
  role: Role | null,
): Promise<void> {
  const user = await findUserBySub(db, claims.sub);
  if (!user) return;
  const email = typeof claims.email === 'string' && claims.email !== '' ? claims.email : null;
  const sameGroups =
    groups.length === user.groups.length && groups.every((group, i) => group === user.groups[i]);
  const changes = {
    ...(email !== null && email !== user.email ? { email } : {}),
    ...(sameGroups ? {} : { groups }),
    ...(role !== null && role !== user.role ? { role } : {}),
  };
  if (Object.keys(changes).length > 0) await updateUserClaims(db, user.id, changes);
}
