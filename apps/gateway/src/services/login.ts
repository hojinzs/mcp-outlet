import type { JWTPayload } from 'jose';
import { type AccessPolicy, decideAccess, extractGroups } from '../auth/access.ts';
import type { Db } from '../db/client.ts';
import { findUserBySub, upsertUserOnLogin } from '../db/queries/users.ts';
import { revokeMembership } from './membership.ts';
import { createSession } from './sessions.ts';

export type LoginResult =
  | { kind: 'denied'; email: string | null }
  | { kind: 'ok'; token: string; expiresAt: Date };

// 검증을 마친 id_token 클레임으로 로그인을 끝낸다.
// 허용 그룹 밖이면 사용자 행도 세션도 만들지 않고, 이미 있는 사용자면 role과 세션을 거둔다 (SCR-COM-03 not_member)
export async function completeLogin(
  db: Db,
  claims: JWTPayload & { sub: string },
  options: { policy: AccessPolicy; ttlHours: number; now: Date },
): Promise<LoginResult> {
  // 이메일이 없는 IdP 계정은 빈 문자열을 보내기도 한다
  const email = typeof claims.email === 'string' && claims.email !== '' ? claims.email : null;
  const groups = extractGroups(claims, options.policy.groupsClaim);
  const decision = decideAccess(groups, options.policy);
  if (!decision.allowed) {
    const existing = await findUserBySub(db, claims.sub);
    if (existing) await revokeMembership(db, existing.id, groups);
    return { kind: 'denied', email };
  }

  const user = await upsertUserOnLogin(
    db,
    { sub: claims.sub, email, groups, role: decision.role },
    options.now,
  );
  const session = await createSession(db, user.id, {
    now: options.now,
    ttlHours: options.ttlHours,
  });
  return { kind: 'ok', ...session };
}
