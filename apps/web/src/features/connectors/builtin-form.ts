import type {
  Builtin,
  BuiltinAuthMethod,
  OAuthConnectorInput,
  ServiceAccountConnectorInput,
} from '../../api/types.ts';
import { checkServiceAccountKey } from './builtin.ts';

// 내장 서비스 입력 (SCR-EP-02 1단계 내장 서비스)

export type BuiltinAuthType = BuiltinAuthMethod['type'];

export type BuiltinFormState = {
  builtin: string | null;
  method: BuiltinAuthType | null;
  name: string;
  // 사용자가 이름을 고치기 전까지는 서비스 이름을 따라간다
  nameEdited: boolean;
  // 서비스 계정 JSON 키 원문. 화면에 다시 보여주지 않는다
  key: string;
  clientId: string;
  clientSecret: string;
};

export const initialBuiltinForm: BuiltinFormState = {
  builtin: null,
  method: null,
  name: '',
  nameEdited: false,
  key: '',
  clientId: '',
  clientSecret: '',
};

// 다른 서비스를 고르면 입력을 비운다. 접속 방식은 authMethods 첫 번째가 기본이다
export function withBuiltin(state: BuiltinFormState, builtin: Builtin): BuiltinFormState {
  if (state.builtin === builtin.key) return state;
  return {
    ...initialBuiltinForm,
    builtin: builtin.key,
    method: builtin.authMethods[0]?.type ?? null,
    name: state.nameEdited ? state.name : builtin.name,
    nameEdited: state.nameEdited,
  };
}

function nameProblem(state: BuiltinFormState): string | undefined {
  const name = state.name.trim();
  if (name.length < 1 || name.length > 60) return '커넥터 이름은 1~60자입니다.';
  return undefined;
}

export function serviceAccountProblem(state: BuiltinFormState): string | undefined {
  if (state.builtin === null) return '내장 서비스를 고르세요.';
  const key = checkServiceAccountKey(state.key);
  if (key.status === 'empty') return '서비스 계정 JSON 키를 넣으세요.';
  if (key.status === 'invalid') return key.problem;
  return nameProblem(state);
}

export function oauthProblem(state: BuiltinFormState): string | undefined {
  if (state.builtin === null) return '내장 서비스를 고르세요.';
  if (!state.clientId.trim() || !state.clientSecret.trim()) {
    return 'Client ID와 Client Secret을 넣으세요.';
  }
  return nameProblem(state);
}

export function toServiceAccountInput(state: BuiltinFormState): ServiceAccountConnectorInput {
  return {
    builtin: state.builtin ?? '',
    name: state.name.trim(),
    auth: { type: 'service_account', key: state.key },
  };
}

export function toOAuthConnectorInput(state: BuiltinFormState): OAuthConnectorInput {
  return {
    builtin: state.builtin ?? '',
    name: state.name.trim(),
    auth: {
      type: 'oauth2',
      clientId: state.clientId.trim(),
      clientSecret: state.clientSecret.trim(),
    },
  };
}
