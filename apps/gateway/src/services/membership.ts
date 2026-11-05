import type { Db } from '../db/client.ts';
import { deleteUserSessions } from '../db/queries/sessions.ts';
import { updateUserClaims } from '../db/queries/users.ts';

// 로그인 허용 그룹에서 빠진 것을 알게 되면(관리 UI 로그인·MCP 요청) 관리자 role을 거두고 세션을 끝낸다.
// 세션 확인과 관리자 API는 DB의 role만 보므로, 여기서 거두지 않으면 남은 쿠키로 계속 쓸 수 있다 (F-AUTH-06)
export async function revokeMembership(db: Db, userId: string, groups: string[]): Promise<void> {
  await updateUserClaims(db, userId, { groups, role: 'user' });
  await deleteUserSessions(db, userId);
}
