import type { JWTPayload } from 'jose';

export type Role = 'user' | 'admin';

export type AccessPolicy = {
  groupsClaim: string;
  // 비어 있으면 IdP 로그인에 성공한 모든 사용자를 허용
  loginGroups: readonly string[];
  adminGroups: readonly string[];
};

export type AccessDecision = { allowed: false } | { allowed: true; role: Role };

// IdP에 따라 groups가 문자열 하나로 오기도 한다. 문자열이 아닌 항목은 버린다
export function extractGroups(claims: JWTPayload, claimName: string): string[] {
  const value = claims[claimName];
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

// 로그인 허용과 role을 groups로만 정한다 (F-AUTH-06). admin도 로그인 허용 조건을 먼저 만족해야 한다
export function decideAccess(groups: readonly string[], policy: AccessPolicy): AccessDecision {
  const memberOf = (wanted: readonly string[]) => wanted.some((group) => groups.includes(group));
  if (policy.loginGroups.length > 0 && !memberOf(policy.loginGroups)) return { allowed: false };
  return { allowed: true, role: memberOf(policy.adminGroups) ? 'admin' : 'user' };
}
