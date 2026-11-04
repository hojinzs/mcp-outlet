import type {
  BuiltinAuthMethod,
  BuiltinConnector,
  BuiltinServiceAccount,
  ServiceAccountKey,
} from '@mcp-outlet/builtin-connectors';
import { type ConnectorManifest, connectorManifestSchema } from '@mcp-outlet/shared';
import { z } from 'zod';
import type { RuntimeConnector } from '../runtimes/types.ts';
import type { CredentialValues } from './credentials.ts';
import { ServiceError } from './errors.ts';

// 내장 커넥터의 인증 방식별 매니페스트와 자격증명 키 (F-CON-02·03)

export type Builtins = ReadonlyMap<string, BuiltinConnector>;
export type BuiltinAuthType = BuiltinAuthMethod['type'];

// 자격증명 JSON 묶음의 키. ACCESS_TOKEN*은 gateway가 발급·갱신해 넣는 값이다
export const CREDENTIAL_KEYS = {
  clientId: 'CLIENT_ID',
  clientSecret: 'CLIENT_SECRET',
  refreshToken: 'REFRESH_TOKEN',
  serviceAccountKey: 'SERVICE_ACCOUNT_KEY',
  accessToken: 'ACCESS_TOKEN',
  accessTokenExpiresAt: 'ACCESS_TOKEN_EXPIRES_AT',
} as const;

export type ResolvedBuiltin<Method extends BuiltinAuthMethod = BuiltinAuthMethod> = {
  builtin: BuiltinConnector;
  method: Method;
};

// 저장된 매니페스트의 내장 커넥터와 인증 방식. 토큰 주소·scope는 매니페스트가 아니라 코드의 정의를 따른다
export function resolveBuiltin(builtins: Builtins, manifest: ConnectorManifest): ResolvedBuiltin {
  if (manifest.runtime !== 'builtin') throw new Error('not a builtin connector');
  const builtin = builtins.get(manifest.builtin);
  const method = builtin?.authMethods.find((item) => item.type === manifest.auth.type);
  if (!builtin || !method) throw new Error(`builtin not available: ${manifest.builtin}`);
  return { builtin, method };
}

export function findAuthMethod<Type extends BuiltinAuthType>(
  builtin: BuiltinConnector,
  type: Type,
): Extract<BuiltinAuthMethod, { type: Type }> | undefined {
  return builtin.authMethods.find(
    (method): method is Extract<BuiltinAuthMethod, { type: Type }> => method.type === type,
  );
}

function authOf(method: BuiltinAuthMethod): ConnectorManifest['auth'] {
  if (method.type === 'service_account') {
    return { type: 'service_account', credential: CREDENTIAL_KEYS.serviceAccountKey };
  }
  return {
    type: 'oauth2',
    authorizationUrl: method.authorizationUrl,
    tokenUrl: method.tokenUrl,
    scopes: [...method.scopes],
    clientIdCredential: CREDENTIAL_KEYS.clientId,
    clientSecretCredential: CREDENTIAL_KEYS.clientSecret,
  };
}

function credentialFieldsOf(method: BuiltinAuthMethod) {
  if (method.type === 'service_account') {
    return [{ key: CREDENTIAL_KEYS.serviceAccountKey, label: '서비스 계정 키', scope: 'user' }];
  }
  return [
    { key: CREDENTIAL_KEYS.clientId, label: 'Client ID', secret: false, scope: 'user' },
    { key: CREDENTIAL_KEYS.clientSecret, label: 'Client Secret', scope: 'user' },
    { key: CREDENTIAL_KEYS.refreshToken, label: 'Refresh token', scope: 'user' },
  ];
}

export function builtinManifest(
  builtin: BuiltinConnector,
  name: string,
  method: BuiltinAuthMethod,
): ConnectorManifest {
  return connectorManifestSchema.parse({
    manifestVersion: 1,
    name,
    runtime: 'builtin',
    builtin: builtin.key,
    credentials: credentialFieldsOf(method),
    auth: authOf(method),
  });
}

// 서비스 계정 키는 필요한 필드만 정규화해 저장한다
export function serviceAccountCredentials(
  method: BuiltinServiceAccount,
  keyJson: string,
): { values: CredentialValues; account: string } | null {
  const key = method.parseKey(keyJson);
  if (!key) return null;
  return {
    values: { [CREDENTIAL_KEYS.serviceAccountKey]: JSON.stringify(key) },
    account: key.clientEmail,
  };
}

const storedKeySchema = z.object({ clientEmail: z.string().min(1), privateKey: z.string().min(1) });

export function storedServiceAccountKey(values: CredentialValues): ServiceAccountKey | null {
  try {
    return storedKeySchema.parse(JSON.parse(values[CREDENTIAL_KEYS.serviceAccountKey] ?? ''));
  } catch {
    return null;
  }
}

export type OAuthClientCredentials = { clientId: string; clientSecret: string };

export function oauthClientOf(values: CredentialValues): OAuthClientCredentials | null {
  const clientId = values[CREDENTIAL_KEYS.clientId];
  const clientSecret = values[CREDENTIAL_KEYS.clientSecret];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export type BuiltinConnectorInput = {
  builtin: string;
  name: string;
  auth: { type: 'service_account'; key: string };
};

// 서비스 계정 키로 만드는 내장 커넥터. 키 형식이 틀리면 invalid_request (field: key)
export function serviceAccountConnector(
  builtins: Builtins,
  input: BuiltinConnectorInput,
): { connector: RuntimeConnector; account: string } {
  const builtin = builtins.get(input.builtin);
  const method = builtin && findAuthMethod(builtin, 'service_account');
  if (!builtin || !method) throw new ServiceError('invalid_request', { field: 'builtin' });
  const credentials = serviceAccountCredentials(method, input.auth.key);
  if (!credentials) throw new ServiceError('invalid_request', { field: 'key' });
  return {
    connector: {
      manifest: builtinManifest(builtin, input.name, method),
      credentials: credentials.values,
    },
    account: credentials.account,
  };
}

// 내장 서비스 카드와 서비스별 접속 방식 (SCR-EP-02 GET /api/builtins). 토큰 주소·scope는 내려주지 않는다
export function builtinCatalog(builtins: Builtins, redirectUri: string) {
  return [...builtins.values()].map((builtin) => ({
    key: builtin.key,
    name: builtin.name,
    description: builtin.description,
    toolCount: builtin.listTools().length,
    authMethods: builtin.authMethods.map((method) =>
      method.type === 'oauth2'
        ? { type: method.type, provider: method.provider, redirectUri }
        : { type: method.type },
    ),
  }));
}
