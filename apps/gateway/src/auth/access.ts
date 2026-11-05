import type { JWTPayload } from 'jose';

export type Role = 'user' | 'admin';

export type AccessPolicy = {
  groupsClaim: string;
  // 비어 있으면 IdP 로그인에 성공한 모든 사용자를 허용
  loginGroups: readonly string[];
  adminGroups: readonly string[];
};

export type AccessDecision = { allowed: false } | { allowed: true; role: Role };

// IdP에 따라 groups가 문자열 하나로 오기도 한다. 문자열이 아닌 항목은 버린다.
// 클레임이 아예 없으면 null. access token에 groups를 싣지 않는 IdP를 빈 그룹과 구분한다 (F-AUTH-06 이식성)
export function readGroupsClaim(claims: JWTPayload, claimName: string): string[] | null {
  const value = claims[claimName];
  if (value === undefined) return null;
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

// 관리 UI 로그인(id_token)은 클레임이 없어도 빈 그룹으로 본다
export function extractGroups(claims: JWTPayload, claimName: string): string[] {
  return readGroupsClaim(claims, claimName) ?? [];
}

// 로그인 허용과 role을 groups로만 정한다 (F-AUTH-06). admin도 로그인 허용 조건을 먼저 만족해야 한다
export function decideAccess(groups: readonly string[], policy: AccessPolicy): AccessDecision {
  const memberOf = (wanted: readonly string[]) => wanted.some((group) => groups.includes(group));
  if (policy.loginGroups.length > 0 && !memberOf(policy.loginGroups)) return { allowed: false };
  return { allowed: true, role: memberOf(policy.adminGroups) ? 'admin' : 'user' };
}
