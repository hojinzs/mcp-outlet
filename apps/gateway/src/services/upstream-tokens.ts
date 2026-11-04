import type { BuiltinAuthMethod } from '@mcp-outlet/builtin-connectors';
import type { SecretBox } from '../crypto/secrets.ts';
import type { Db } from '../db/client.ts';
import { markReauthRequired } from '../db/queries/connectors.ts';
import { lockUserCredential, replaceCiphertext } from '../db/queries/credentials.ts';
import type { RuntimeConnector } from '../runtimes/types.ts';
import { type OAuth2Client, TokenError, type TokenResponse } from '../upstream/oauth2.ts';
import {
  type Builtins,
  CREDENTIAL_KEYS,
  oauthClientOf,
  resolveBuiltin,
  storedServiceAccountKey,
} from './builtin-auth.ts';
import { type CredentialValues, openCredentials } from './credentials.ts';

// 내장 커넥터의 업스트림 access token. 만료 전에 OAuth refresh·서비스 계정 assertion으로 새로 받고
// 암호화된 자격증명에 다시 저장한다 (F-CON-03). 갱신이 거부되면 커넥터를 재연결 필요로 바꾼다 (F-RUN-03)

export type UpstreamTokensDeps = {
  db: Db;
  secrets: SecretBox;
  oauth: OAuth2Client;
  builtins: Builtins;
  now: () => Date;
};

// 만료 직전 토큰으로 호출하다 실패하지 않게 여유를 둔다
const EXPIRY_MARGIN_MS = 60_000;

function cachedToken(values: CredentialValues, now: Date): string | undefined {
  const token = values[CREDENTIAL_KEYS.accessToken];
  const expiresAt = Number(values[CREDENTIAL_KEYS.accessTokenExpiresAt]);
  if (!token || !(expiresAt - EXPIRY_MARGIN_MS > now.getTime())) return undefined;
  return token;
}

function issueToken(
  oauth: OAuth2Client,
  method: BuiltinAuthMethod,
  values: CredentialValues,
): Promise<TokenResponse> {
  if (method.type === 'service_account') {
    const key = storedServiceAccountKey(values);
    if (!key) throw new TokenError('invalid_grant');
    return oauth.serviceAccountToken(method.tokenUrl, { ...key, scopes: method.scopes });
  }
  const client = oauthClientOf(values);
  const refreshToken = values[CREDENTIAL_KEYS.refreshToken];
  if (!client || !refreshToken) throw new TokenError('invalid_grant');
  return oauth.refresh(method.tokenUrl, { ...client, refreshToken });
}

// 업스트림이 refresh token을 새로 주면(회전) 바꿔 둔다
function withToken(values: CredentialValues, token: TokenResponse): CredentialValues {
  return {
    ...values,
    [CREDENTIAL_KEYS.accessToken]: token.accessToken,
    [CREDENTIAL_KEYS.accessTokenExpiresAt]: String(token.expiresAt),
    ...(token.refreshToken ? { [CREDENTIAL_KEYS.refreshToken]: token.refreshToken } : {}),
  };
}

export function createUpstreamTokens(deps: UpstreamTokensDeps) {
  // 같은 프로세스 안의 동시 갱신은 하나로 합친다. 다른 인스턴스와는 행 잠금으로 맞춘다
  const inflight = new Map<string, Promise<string>>();

  async function refreshSaved(
    method: BuiltinAuthMethod,
    ref: { connectorId: string; userId: string },
  ): Promise<string> {
    try {
      return await deps.db.transaction(async (tx) => {
        const row = await lockUserCredential(tx, ref.connectorId, ref.userId);
        if (!row) throw new TokenError('invalid_grant');
        const values = openCredentials(deps.secrets, row.ciphertext);
        // 잠금을 기다리는 동안 다른 요청이 이미 갱신했을 수 있다
        const fresh = cachedToken(values, deps.now());
        if (fresh) return fresh;
        const token = await issueToken(deps.oauth, method, values);
        const next = withToken(values, token);
        await replaceCiphertext(tx, row.id, deps.secrets.encrypt(JSON.stringify(next)));
        return token.accessToken;
      });
    } catch (error) {
      if (error instanceof TokenError && error.kind === 'invalid_grant') {
        await markReauthRequired(deps.db, ref.connectorId);
      }
      throw error;
    }
  }

  // 실패하면 TokenError를 던진다
  async function accessToken(connector: RuntimeConnector): Promise<string> {
    const { method } = resolveBuiltin(deps.builtins, connector.manifest);
    const cached = cachedToken(connector.credentials, deps.now());
    if (cached) return cached;

    const ref = connector.credentialRef;
    // 저장 전 연결 테스트: 받은 토큰을 둘 곳이 없으므로 발급만 한다
    if (!ref) return (await issueToken(deps.oauth, method, connector.credentials)).accessToken;

    const key = `${ref.connectorId}:${ref.userId}`;
    const running = inflight.get(key);
    if (running) return running;
    const task = refreshSaved(method, ref).finally(() => inflight.delete(key));
    inflight.set(key, task);
    return task;
  }

  return { accessToken };
}

export type UpstreamTokens = ReturnType<typeof createUpstreamTokens>;
