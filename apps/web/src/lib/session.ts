import { requests } from '../api/queries.ts';
import type { AuthOptions } from '../api/types.ts';

// 일반 로그아웃은 gateway 세션만, "다른 계정으로 로그인"은 IdP 세션까지 끝낸다 (SCR-COM-01 결정 사항).
// gateway가 돌려준 주소(IdP end_session 또는 로그인 화면)로 이동한다
export async function logout(options: { idp: boolean }): Promise<void> {
  const { redirectTo } = await requests.logout(options.idp);
  window.location.assign(redirectTo);
}

// SCR-COM-03 "다른 계정으로 로그인": IdP가 end_session을 지원하면 버튼, 아니면 직접 로그아웃 안내.
// /auth/options를 받지 못하면 지원 여부를 모르므로 안내로 대신한다. 받는 중에는 아무것도 그리지 않는다
export function accountSwitchMode(options: {
  isError: boolean;
  data?: AuthOptions;
}): 'button' | 'notice' | null {
  if (options.isError) return 'notice';
  if (!options.data) return null;
  return options.data.idpLogout ? 'button' : 'notice';
}
