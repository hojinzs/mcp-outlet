import type { JWTPayload } from 'jose';
import { type AccessPolicy, decideAccess, extractGroups } from '../auth/access.ts';
import type { Db } from '../db/client.ts';
import { upsertUserOnLogin } from '../db/queries/users.ts';
import { createSession } from './sessions.ts';

export type LoginResult =
  | { kind: 'denied'; email: string | null }
  | { kind: 'ok'; token: string; expiresAt: Date };

// 검증을 마친 id_token 클레임으로 로그인을 끝낸다.
// 허용 그룹 밖이면 사용자 행도 세션도 만들지 않는다 (SCR-COM-03 not_member)
export async function completeLogin(
  db: Db,
  claims: JWTPayload & { sub: string },
  options: { policy: AccessPolicy; ttlHours: number; now: Date },
): Promise<LoginResult> {
  const email = typeof claims.email === 'string' ? claims.email : null;
  const groups = extractGroups(claims, options.policy.groupsClaim);
  const decision = decideAccess(groups, options.policy);
  if (!decision.allowed) return { kind: 'denied', email };

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
