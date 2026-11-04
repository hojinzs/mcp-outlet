import { BuiltinApiError } from '../errors.ts';
import { createToolSet } from '../tools.ts';
import type { BuiltinCallContext, BuiltinConnector } from '../types.ts';
import { googleOAuth2, googleServiceAccount } from './auth.ts';
import { GA4_SCOPE, ga4Tools, listAccountSummaries } from './ga4.ts';
import { listSites, SEARCH_CONSOLE_SCOPE, searchConsoleTools } from './search-console.ts';

// GA4와 Search Console을 한 커넥터로 묶는다 (PRD v1 커넥터 후보 P0, SCR-EP-02 카드 하나)

const scopes = [GA4_SCOPE, SEARCH_CONSOLE_SCOPE];
const tools = createToolSet([...ga4Tools, ...searchConsoleTools]);

// 둘 중 하나만 쓰는 계정도 있으므로 한쪽이라도 조회되면 통과로 본다.
// 둘 다 실패하면 GA 쪽 분류를 돌려준다
async function checkAccess(ctx: BuiltinCallContext): Promise<void> {
  try {
    await listAccountSummaries(ctx, 1);
    return;
  } catch (gaError) {
    if (!(gaError instanceof BuiltinApiError)) throw gaError;
    if (gaError.kind !== 'permission_denied' && gaError.kind !== 'not_found') throw gaError;
    try {
      await listSites(ctx);
    } catch {
      throw gaError;
    }
  }
}

export const googleAnalytics: BuiltinConnector = {
  key: 'google-analytics',
  name: 'Google Analytics 4 + Search Console',
  description:
    'GA4 속성 목록·보고서·실시간 보고서와 Search Console 사이트·검색 실적·URL 검사를 조회합니다.',
  // 서비스 계정을 먼저 보여준다. 테스트 상태 외부 OAuth 앱은 refresh token이 7일에 만료된다 (SCR-EP-02)
  authMethods: [googleServiceAccount(scopes), googleOAuth2(scopes)],
  listTools: tools.listTools,
  checkAccess,
  callTool: tools.callTool,
};
