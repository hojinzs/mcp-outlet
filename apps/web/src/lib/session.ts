import { requests } from '../api/queries.ts';

// 일반 로그아웃은 gateway 세션만, "다른 계정으로 로그인"은 IdP 세션까지 끝낸다 (SCR-COM-01 결정 사항).
// gateway가 돌려준 주소(IdP end_session 또는 로그인 화면)로 이동한다
export async function logout(options: { idp: boolean }): Promise<void> {
  const { redirectTo } = await requests.logout(options.idp);
  window.location.assign(redirectTo);
}
