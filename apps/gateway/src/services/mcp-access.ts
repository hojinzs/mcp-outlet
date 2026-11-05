import type { JWTPayload } from 'jose';
import { type AccessPolicy, decideAccess, type Role, readGroupsClaim } from '../auth/access.ts';
import type { Db } from '../db/client.ts';
import type { ConnectorRow } from '../db/queries/connectors.ts';
import { type EndpointRow, findEndpointForMcp } from '../db/queries/endpoints.ts';
import { findUserBySub, updateUserClaims } from '../db/queries/users.ts';
import { revokeMembership } from './membership.ts';

// 검증을 마친 MCP 토큰으로 엔드포인트 호출 권한을 정한다

export type McpAccess =
  | { kind: 'ok'; endpoint: EndpointRow; connector: ConnectorRow }
  // 로그인 허용 그룹에서 빠진 사용자 (F-AUTH-06)
  | { kind: 'not_member' }
  // 없는 엔드포인트와 다른 사람의 엔드포인트를 구분하지 않는다 (F-AUTH-05)
  | { kind: 'not_found' }
  | { kind: 'endpoint_disabled' }
  // 감사 로그에 거부로 남기도록 대상을 함께 준다
  | { kind: 'connector_disabled'; endpoint: EndpointRow; connector: ConnectorRow };

export type McpAccessLog = {
  warn: (fields: Record<string, unknown>, message: string) => void;
};

export async function resolveMcpAccess(
  db: Db,
  claims: JWTPayload & { sub: string },
  endpointId: string | null,
  policy: AccessPolicy,
  log: McpAccessLog,
): Promise<McpAccess> {
  const user = await findUserBySub(db, claims.sub);
  const tokenGroups = readGroupsClaim(claims, policy.groupsClaim);
  // access token에 groups를 싣지 않는 IdP는 마지막 관리 UI 로그인 때 저장한 groups로 판정한다.
  // 관리 UI에 로그인한 적이 없으면 빈 그룹이다 (F-AUTH-06 이식성)
  if (tokenGroups === null) {
    log.warn({ groupsClaim: policy.groupsClaim }, 'mcp access token has no groups claim');
  }
  const groups = tokenGroups ?? user?.groups ?? [];
  const decision = decideAccess(groups, policy);
  if (!decision.allowed) {
    if (user) await revokeMembership(db, user.id, groups);
    return { kind: 'not_member' };
  }
  if (user) await refreshUser(db, user, claims, tokenGroups, decision.role);

  const row = endpointId ? await findEndpointForMcp(db, endpointId) : undefined;
  if (!row || row.ownerSub !== claims.sub) return { kind: 'not_found' };
  if (row.connector.disabledAt) {
    return { kind: 'connector_disabled', endpoint: row.endpoint, connector: row.connector };
  }
  if (!row.endpoint.enabled) return { kind: 'endpoint_disabled' };
  return { kind: 'ok', endpoint: row.endpoint, connector: row.connector };
}

// MCP 요청마다 토큰 클레임으로 email·groups·role을 맞춘다 (F-AUTH-06). 바뀐 값만 쓴다.
// 토큰에 email이나 groups 클레임이 없으면 기존 값을 둔다
async function refreshUser(
  db: Db,
  user: NonNullable<Awaited<ReturnType<typeof findUserBySub>>>,
  claims: JWTPayload,
  groups: string[] | null,
  role: Role,
): Promise<void> {
  const email = typeof claims.email === 'string' && claims.email !== '' ? claims.email : null;
  const sameGroups =
    groups === null ||
    (groups.length === user.groups.length && groups.every((group, i) => group === user.groups[i]));
  const changes = {
    ...(email !== null && email !== user.email ? { email } : {}),
    ...(sameGroups ? {} : { groups }),
    ...(role !== user.role ? { role } : {}),
  };
  if (Object.keys(changes).length > 0) await updateUserClaims(db, user.id, changes);
}
