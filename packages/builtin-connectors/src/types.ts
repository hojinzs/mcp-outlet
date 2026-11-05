import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

// builtin 커넥터 공통 인터페이스 (F-RUN-02).
// 토큰 발급·갱신·저장은 gateway가 맡고, 커넥터는 받은 access token으로 API만 호출한다

// 업스트림 OAuth2: 사용자가 자기 OAuth 앱의 client id·secret을 입력하고 동의한다 (F-CON-03)
export type BuiltinOAuth2 = {
  type: 'oauth2';
  // 화면의 "{provider}로 연결" 버튼 문구
  provider: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: readonly string[];
  // refresh token을 받기 위한 업스트림별 추가 파라미터
  authorizationParams: Readonly<Record<string, string>>;
};

export type ServiceAccountKey = { clientEmail: string; privateKey: string };

// 서비스 계정 JSON 키로 JWT bearer 토큰을 받는다 (RFC 7523)
export type BuiltinServiceAccount = {
  type: 'service_account';
  // 키 파일의 token_uri는 쓰지 않고 이 주소로만 보낸다 (사용자 입력 주소로 요청하지 않기 위해)
  tokenUrl: string;
  scopes: readonly string[];
  // 형식이 틀리면 null
  parseKey(json: string): ServiceAccountKey | null;
};

export type BuiltinAuthMethod = BuiltinOAuth2 | BuiltinServiceAccount;

export interface BuiltinCallContext {
  // gateway가 발급·갱신한 업스트림 access token
  accessToken: string;
  fetch: typeof fetch;
  // 클라이언트 abort와 업스트림 타임아웃을 함께 건 신호
  signal: AbortSignal;
}

export interface BuiltinConnector {
  // 매니페스트의 `builtin` 값과 일치하는 키
  key: string;
  name: string;
  description: string;
  // 화면에 보여줄 순서대로
  authMethods: readonly BuiltinAuthMethod[];
  listTools(): Tool[];
  // 연결 테스트: 받은 토큰으로 가벼운 조회가 되는지 확인한다. 실패하면 BuiltinApiError를 던진다
  checkAccess(ctx: BuiltinCallContext): Promise<void>;
  // 실패는 오류 결과로 돌려준다. 업스트림이 자격증명을 거부하면(auth_failed)
  // BuiltinApiError를 던진다
  callTool(
    name: string,
    args: Record<string, unknown>,
    ctx: BuiltinCallContext,
  ): Promise<CallToolResult>;
}
