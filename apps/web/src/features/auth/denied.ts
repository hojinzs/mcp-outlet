// SCR-COM-03 접근 거부(not_member) 문구. 이메일은 gateway가 GET /auth/denied로 준다
export function notMemberMessage(email: string | null): string {
  const account = email ? `${email} 계정은` : '이 계정은';
  return `${account} MCP Outlet 사용 그룹에 속해 있지 않습니다. 관리자에게 그룹 추가를 요청하세요.`;
}
