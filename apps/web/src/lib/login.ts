// 로그인 경로와 returnTo 규칙 (SCR-COM-02)

export const HOME_PATH = '/admin/';
export const LOGIN_PATH = '/admin/login';

// /admin/ 아래 경로만 받는다. 외부 주소로 보내는 오픈 리다이렉트를 막는다
export function safeReturnTo(value: string | null | undefined): string | undefined {
  if (!value?.startsWith('/admin/')) return undefined;
  if (value.includes('\\') || value.startsWith('/admin/login')) return undefined;
  return value;
}

// 세션이 만료된 화면에서 로그인 시작 화면으로 갈 주소. 지금 경로를 returnTo로 붙인다
export function loginPagePath(current: string): string {
  const returnTo = safeReturnTo(current);
  return returnTo ? `${LOGIN_PATH}?${new URLSearchParams({ returnTo })}` : LOGIN_PATH;
}

// IdP 로그인을 시작하는 gateway 주소
export function loginStartUrl(returnTo: string | undefined): string {
  const params = new URLSearchParams({ returnTo: returnTo ?? HOME_PATH });
  return `/auth/login?${params}`;
}

const loginErrors: Record<string, string> = {
  access_denied: '로그인을 취소했습니다. 다시 시도하세요.',
  state_mismatch: '로그인 요청이 만료됐습니다. 다시 시도하세요.',
  idp_error: '로그인 서버에서 오류가 났습니다. 잠시 후 다시 시도하세요.',
};

// IdP 오류 원문은 보여주지 않고 분류별 고정 문구만 쓴다
export function loginErrorMessage(code: string | null): string | undefined {
  if (!code) return undefined;
  return loginErrors[code] ?? '로그인하지 못했습니다. 다시 시도하세요.';
}
