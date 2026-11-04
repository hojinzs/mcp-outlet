import type { ConnectionTestFailure, RemoteConnectorInput } from '../../api/types.ts';

// 원격 MCP 서버 입력 (SCR-EP-02 1단계)

export type RemoteFormState = {
  url: string;
  name: string;
  // 사용자가 이름을 고치기 전까지는 주소의 호스트 이름을 따라간다
  nameEdited: boolean;
  authType: 'none' | 'static_token';
  token: string;
  header: string;
  prefix: string;
};

export const initialRemoteForm: RemoteFormState = {
  url: '',
  name: '',
  nameEdited: false,
  authType: 'static_token',
  token: '',
  header: 'Authorization',
  prefix: 'Bearer ',
};

export function hostnameOf(url: string): string {
  try {
    return new URL(url.trim()).hostname;
  } catch {
    return '';
  }
}

export function withUrl(state: RemoteFormState, url: string): RemoteFormState {
  return { ...state, url, name: state.nameEdited ? state.name : hostnameOf(url) };
}

// 형식만 본다. https 여부와 내부망 주소는 gateway가 판정한다 (F-CON-06)
export function remoteFormProblem(state: RemoteFormState): string | undefined {
  let url: URL;
  try {
    url = new URL(state.url.trim());
  } catch {
    return '커넥터 주소를 넣으세요.';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'https:// 주소를 넣으세요.';
  const name = state.name.trim();
  if (name.length < 1 || name.length > 60) return '커넥터 이름은 1~60자입니다.';
  if (state.authType === 'static_token' && !state.token) return '토큰을 넣으세요.';
  return undefined;
}

export function toRemoteInput(state: RemoteFormState): RemoteConnectorInput {
  return {
    name: state.name.trim(),
    url: state.url.trim(),
    auth:
      state.authType === 'none'
        ? { type: 'none' }
        : {
            type: 'static_token',
            token: state.token,
            header: state.header.trim(),
            prefix: state.prefix,
          },
  };
}

// 실패하면 분류만 보여준다. 업스트림 응답 본문과 예외 원문은 보여주지 않는다 (F-RUN-03)
export const connectionTestMessages: Record<ConnectionTestFailure, string> = {
  private_address: '내부망 주소는 등록할 수 없습니다. 인터넷에서 접근할 수 있는 주소를 넣으세요',
  unreachable: '서버에 연결하지 못했습니다. 주소를 확인하세요',
  auth_failed: '서버가 토큰을 거부했습니다. 토큰과 헤더 설정을 확인하세요',
  not_mcp: '이 주소에서 MCP 응답을 받지 못했습니다. MCP 서버 주소가 맞는지 확인하세요',
  timeout: '커넥터 응답이 너무 늦습니다. 잠시 후 다시 시도하세요',
  redirect: '서버가 다른 주소로 보냈습니다. 최종 주소를 직접 넣으세요',
};

export function connectionTestMessage(result: string): string {
  return (
    connectionTestMessages[result as ConnectionTestFailure] ??
    '연결 테스트에 실패했습니다. 잠시 후 다시 시도하세요'
  );
}
