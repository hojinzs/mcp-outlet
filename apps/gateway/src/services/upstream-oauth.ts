import {
  createUpstreamState,
  type UpstreamState,
  upstreamCodeChallenge,
} from '../auth/upstream-state.ts';
import {
  deleteStalePendingConnectors,
  findConnector,
  insertConnector,
  updateConnector,
} from '../db/queries/connectors.ts';
import { type OAuth2Client, TokenError } from '../upstream/oauth2.ts';
import {
  builtinManifest,
  CREDENTIAL_KEYS,
  findAuthMethod,
  type OAuthClientCredentials,
  oauthClientOf,
} from './builtin-auth.ts';
import {
  assertConnectorQuota,
  type ConnectorServiceDeps,
  type ConnectorView,
  getConnector,
} from './connectors.ts';
import { loadCredentials, saveCredentials } from './credentials.ts';
import { ServiceError } from './errors.ts';

// 내장 커넥터의 업스트림 OAuth2 계정 연결 (F-CON-03·04, SCR-EP-02 "계정 연결 순서").
// 받은 refresh token을 둘 곳이 있어야 해서 커넥터를 "연결 중"으로 먼저 저장하고 동의 화면으로 보낸다

export type UpstreamOAuthDeps = ConnectorServiceDeps & {
  oauth: OAuth2Client;
  // {PUBLIC_BASE_URL}/auth/upstream/callback
  redirectUri: string;
};

export type OAuthConnectorInput = {
  builtin: string;
  name: string;
  auth: { type: 'oauth2' } & OAuthClientCredentials;
};

// 24시간 안에 엔드포인트를 만들지 않은 "연결 중" 커넥터는 지운다 (SCR-EP-02).
// 다음 생성 때와 보관 주기 작업(services/retention.ts)에서 지운다
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export type UpstreamOAuthResult = 'connected' | 'state_mismatch' | 'failed';

function oauthBuiltin(deps: Pick<ConnectorServiceDeps, 'builtins'>, key: string) {
  const builtin = deps.builtins.get(key);
  const method = builtin && findAuthMethod(builtin, 'oauth2');
  if (!builtin || !method) throw new ServiceError('invalid_request', { field: 'builtin' });
  return { builtin, method };
}

export async function createOAuthConnector(
  deps: UpstreamOAuthDeps,
  ownerId: string,
  input: OAuthConnectorInput,
): Promise<ConnectorView> {
  const { builtin, method } = oauthBuiltin(deps, input.builtin);
  await deleteStalePendingConnectors(
    deps.db,
    new Date(deps.now().getTime() - PENDING_TTL_MS),
    ownerId,
  );
  await assertConnectorQuota(deps, ownerId);
  const connector = await deps.db.transaction(async (tx) => {
    const row = await insertConnector(tx, {
      ownerId,
      runtime: 'builtin',
      manifest: builtinManifest(builtin, input.name, method),
      status: 'pending',
    });
    await saveCredentials(
      { db: tx, secrets: deps.secrets },
      { connectorId: row.id, userId: ownerId },
      {
        [CREDENTIAL_KEYS.clientId]: input.auth.clientId,
        [CREDENTIAL_KEYS.clientSecret]: input.auth.clientSecret,
      },
    );
    return row;
  });
  return getConnector(deps, ownerId, connector.id);
}

// 동의 화면 주소와 콜백까지 보관할 state. client를 주면 동의가 끝난 뒤 그 OAuth 앱으로 바꾼다
export async function startUpstreamOAuth(
  deps: UpstreamOAuthDeps,
  ownerId: string,
  connectorId: string,
  input: { returnTo?: string | undefined; client?: OAuthClientCredentials | undefined },
): Promise<{ authorizationUrl: string; state: UpstreamState }> {
  const row = await findConnector(deps.db, ownerId, connectorId);
  if (!row) throw new ServiceError('not_found');
  const { manifest } = row.connector;
  if (manifest.runtime !== 'builtin') throw new ServiceError('invalid_request');
  const { method } = oauthBuiltin(deps, manifest.builtin);
  const stored =
    manifest.auth.type === 'oauth2'
      ? oauthClientOf(await loadCredentials(deps, connectorId, ownerId))
      : null;
  const client = input.client ?? stored;
  if (!client) throw new ServiceError('invalid_request', { field: 'clientId' });

  const state = createUpstreamState(
    { connectorId, userId: ownerId, returnTo: input.returnTo, client: input.client },
    deps.now(),
  );
  const url = new URL(method.authorizationUrl);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: deps.redirectUri,
    scope: method.scopes.join(' '),
    state: state.state,
    code_challenge: upstreamCodeChallenge(state),
    code_challenge_method: 'S256',
    ...method.authorizationParams,
  }).toString();
  return { authorizationUrl: url.toString(), state };
}

// 콜백: 세션 사용자가 커넥터 소유자일 때만 코드를 토큰으로 바꿔 암호화 저장한다
export async function completeUpstreamOAuth(
  deps: UpstreamOAuthDeps,
  sessionUserId: string,
  state: UpstreamState,
  code: string,
): Promise<UpstreamOAuthResult> {
  if (state.userId !== sessionUserId) return 'state_mismatch';
  const row = await findConnector(deps.db, sessionUserId, state.connectorId);
  if (row?.connector.manifest.runtime !== 'builtin') return 'state_mismatch';
  const { connector } = row;
  const { builtin, method } = oauthBuiltin(deps, row.connector.manifest.builtin);
  const client =
    state.client ?? oauthClientOf(await loadCredentials(deps, connector.id, sessionUserId));
  if (!client) return 'failed';

  let token: Awaited<ReturnType<OAuth2Client['exchangeCode']>>;
  try {
    token = await deps.oauth.exchangeCode(method.tokenUrl, {
      code,
      codeVerifier: state.codeVerifier,
      redirectUri: deps.redirectUri,
      ...client,
    });
  } catch (error) {
    if (error instanceof TokenError) return 'failed';
    throw error;
  }
  // refresh token이 없으면 자동 갱신을 할 수 없다
  const refreshToken = token.refreshToken;
  if (!refreshToken) return 'failed';

  await deps.db.transaction(async (tx) => {
    await updateConnector(tx, sessionUserId, connector.id, {
      manifest: builtinManifest(builtin, connector.manifest.name, method),
      // 처음 연결이면 화면의 연결 테스트가 끝날 때까지 "연결 중"으로 둔다
      status: connector.status === 'pending' ? 'pending' : 'ok',
    });
    await saveCredentials(
      { db: tx, secrets: deps.secrets },
      { connectorId: connector.id, userId: sessionUserId },
      {
        [CREDENTIAL_KEYS.clientId]: client.clientId,
        [CREDENTIAL_KEYS.clientSecret]: client.clientSecret,
        [CREDENTIAL_KEYS.refreshToken]: refreshToken,
        [CREDENTIAL_KEYS.accessToken]: token.accessToken,
        [CREDENTIAL_KEYS.accessTokenExpiresAt]: String(token.expiresAt),
      },
      token.email ?? null,
    );
  });
  return 'connected';
}
