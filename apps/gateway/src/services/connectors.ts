import { type ConnectorManifest, connectorManifestSchema } from '@mcp-outlet/shared';
import type { SecretBox } from '../crypto/secrets.ts';
import type { Db, DbOrTx } from '../db/client.ts';
import {
  type ConnectorRow,
  countConnectors,
  deleteConnector as deleteConnectorRow,
  findConnector,
  insertConnector,
  listConnectors as listConnectorRows,
  updateConnector,
} from '../db/queries/connectors.ts';
import { type Runtimes, runtimeFor } from '../runtimes/index.ts';
import type {
  CachedTool,
  ConnectionTest,
  ConnectionTestResult,
  RuntimeConnector,
} from '../runtimes/types.ts';
import {
  type BuiltinConnectorInput,
  type Builtins,
  serviceAccountConnector,
} from './builtin-auth.ts';
import { type CredentialValues, loadCredentials, saveCredentials } from './credentials.ts';
import { connectionTestFailed, ServiceError } from './errors.ts';

// 개인 커넥터(원격·내장) 등록·교체·재테스트·삭제 (F-CON-01·02·04·05)

export type ConnectorServiceDeps = {
  db: Db;
  secrets: SecretBox;
  runtimes: Runtimes;
  builtins: Builtins;
  maxConnectorsPerUser: number;
  now: () => Date;
};

export type StaticTokenSettings = { header: string; prefix: string };

export type RemoteConnectorInput = {
  name: string;
  url: string;
  auth: { type: 'none' } | ({ type: 'static_token'; token: string } & StaticTokenSettings);
};

// 저장하지 않고 연결 테스트하거나 엔드포인트와 함께 저장할 수 있는 새 커넥터.
// 업스트림 OAuth 내장 커넥터는 동의를 받아야 해서 먼저 저장한다 (upstream-oauth.ts)
export type NewConnectorInput = RemoteConnectorInput | BuiltinConnectorInput;

// token을 비우면 저장된 토큰을 그대로 쓴다. url·static_token은 원격, service_account는 내장 커넥터만
export type ConnectorPatch = {
  name?: string | undefined;
  url?: string | undefined;
  auth?:
    | { type: 'none' }
    | ({ type: 'static_token'; token?: string | undefined } & StaticTokenSettings)
    | { type: 'service_account'; key: string }
    | undefined;
};

type PreparedConnector = { connector: RuntimeConnector; account: string | null };

// 원격 커넥터의 정적 토큰은 자격증명 필드 하나로 둔다
const TOKEN_KEY = 'TOKEN';

function remoteConnector(input: RemoteConnectorInput): RuntimeConnector {
  const tokenAuth = input.auth.type === 'static_token' ? input.auth : undefined;
  const manifest = connectorManifestSchema.parse({
    manifestVersion: 1,
    name: input.name,
    runtime: 'remote',
    url: input.url,
    credentials: tokenAuth ? [{ key: TOKEN_KEY, label: '토큰', secret: true, scope: 'user' }] : [],
    auth: tokenAuth
      ? {
          type: 'static_token',
          credential: TOKEN_KEY,
          header: tokenAuth.header,
          prefix: tokenAuth.prefix,
        }
      : { type: 'none' },
  });
  return { manifest, credentials: tokenAuth ? { [TOKEN_KEY]: tokenAuth.token } : {} };
}

function newConnector(
  deps: Pick<ConnectorServiceDeps, 'builtins'>,
  input: NewConnectorInput,
): PreparedConnector {
  if ('builtin' in input) return serviceAccountConnector(deps.builtins, input);
  return { connector: remoteConnector(input), account: null };
}

export async function testConnector(
  runtimes: Runtimes,
  connector: RuntimeConnector,
): Promise<ConnectionTest> {
  return runtimeFor(runtimes, connector.manifest).testConnection(connector);
}

// 저장하지 않은 설정으로 연결 테스트한다. 토큰은 저장·기록하지 않는다 (SCR-EP-02)
export async function testUnsavedConnector(
  deps: Pick<ConnectorServiceDeps, 'runtimes' | 'builtins'>,
  input: NewConnectorInput,
): Promise<ConnectionTest> {
  return testConnector(deps.runtimes, newConnector(deps, input).connector);
}

export async function assertConnectorQuota(
  deps: Pick<ConnectorServiceDeps, 'db' | 'maxConnectorsPerUser'>,
  ownerId: string,
): Promise<void> {
  const count = await countConnectors(deps.db, ownerId);
  if (count >= deps.maxConnectorsPerUser) {
    throw new ServiceError('limit_exceeded', {
      resource: 'connector',
      limit: deps.maxConnectorsPerUser,
    });
  }
}

// 등록할 때 연결 테스트가 성공해야 저장한다 (F-CON-05). 엔드포인트와 한 트랜잭션에 넣도록 tx를 받는다
export async function registerTestedConnector(
  deps: Pick<ConnectorServiceDeps, 'runtimes' | 'builtins' | 'secrets' | 'now'>,
  input: NewConnectorInput,
): Promise<{
  tools: CachedTool[];
  save: (tx: DbOrTx, ownerId: string) => Promise<ConnectorRow>;
}> {
  const { connector, account } = newConnector(deps, input);
  const test = await testConnector(deps.runtimes, connector);
  if (test.result !== 'ok') throw connectionTestFailed(test.result);
  const now = deps.now();
  return {
    tools: test.tools,
    async save(tx, ownerId) {
      const row = await insertConnector(tx, {
        ownerId,
        runtime: connector.manifest.runtime,
        manifest: connector.manifest,
        toolsCache: test.tools,
        toolsCachedAt: now,
        status: 'ok',
        lastTestedAt: now,
        lastTestResult: 'ok',
      });
      await saveCredentials(
        { db: tx, secrets: deps.secrets },
        { connectorId: row.id, userId: ownerId },
        connector.credentials,
        account,
      );
      return row;
    },
  };
}

type ConnectorWithCounts = NonNullable<Awaited<ReturnType<typeof findConnector>>>;

// 비밀값은 내려주지 않고 설정 여부와 변경 시각만 준다
function connectorView(row: ConnectorWithCounts) {
  const { connector } = row;
  const manifest = connector.manifest;
  const auth = manifest.auth;
  return {
    id: connector.id,
    name: manifest.name,
    runtime: connector.runtime,
    url: manifest.runtime === 'remote' ? manifest.url : null,
    builtin: manifest.runtime === 'builtin' ? manifest.builtin : null,
    auth:
      auth.type === 'static_token'
        ? { type: auth.type, header: auth.header, prefix: auth.prefix }
        : { type: auth.type },
    credential: {
      configured: row.credentialUpdatedAt !== null,
      updatedAt: row.credentialUpdatedAt,
      // 연결된 업스트림 계정(이메일). 비밀값이 아니다
      account: row.credentialAccount,
    },
    status: connector.status,
    disabledAt: connector.disabledAt,
    disabledReason: connector.disabledReason,
    lastTestedAt: connector.lastTestedAt,
    lastTestResult: connector.lastTestResult,
    toolCount: connector.toolsCache?.length ?? 0,
    toolsCachedAt: connector.toolsCachedAt,
    endpointCount: row.endpointCount,
    lastCalledAt: connector.lastCalledAt,
    createdAt: connector.createdAt,
    updatedAt: connector.updatedAt,
  };
}

export type ConnectorView = ReturnType<typeof connectorView>;

export async function listConnectors(deps: Pick<ConnectorServiceDeps, 'db'>, ownerId: string) {
  const rows = await listConnectorRows(deps.db, ownerId);
  return rows.map(connectorView);
}

async function requireConnector(db: DbOrTx, ownerId: string, id: string) {
  const row = await findConnector(db, ownerId, id);
  if (!row) throw new ServiceError('not_found');
  return row;
}

export async function getConnector(
  deps: Pick<ConnectorServiceDeps, 'db'>,
  ownerId: string,
  id: string,
): Promise<ConnectorView> {
  return connectorView(await requireConnector(deps.db, ownerId, id));
}

export async function getConnectorTools(
  deps: Pick<ConnectorServiceDeps, 'db'>,
  ownerId: string,
  id: string,
) {
  const { connector } = await requireConnector(deps.db, ownerId, id);
  return { tools: connector.toolsCache ?? [], cachedAt: connector.toolsCachedAt };
}

async function savedConnector(
  deps: Pick<ConnectorServiceDeps, 'db' | 'secrets'>,
  row: ConnectorRow,
  ownerId: string,
): Promise<RuntimeConnector> {
  const credentials = await loadCredentials(deps, row.id, ownerId);
  return {
    manifest: row.manifest,
    credentials,
    credentialRef: { connectorId: row.id, userId: ownerId },
  };
}

// 커넥터를 오류로 바꾸는 실패. 인증·연결 실패만 해당한다. 일시 장애(timeout·upstream_error)와
// 자격증명은 유효한 권한 문제(permission_denied)는 상태를 두고 마지막 테스트 결과로만 보여준다
// (F-CON-05 커넥터 오류 상태의 범위)
const MARKS_ERROR: Record<Exclude<ConnectionTestResult, 'ok'>, boolean> = {
  auth_failed: true,
  unreachable: true,
  not_mcp: true,
  private_address: true,
  redirect: true,
  timeout: false,
  upstream_error: false,
  permission_denied: false,
};

// 연결 중(첫 연결 테스트 전) 커넥터는 테스트에 실패해도 연결 중으로 둔다.
// 오류로 바꾸면 엔드포인트 없이 남아도 24시간 정리 대상에서 빠진다 (SCR-EP-02)
function statusAfterTest(
  current: ConnectorRow['status'],
  test: ConnectionTest,
): ConnectorRow['status'] {
  if (test.result === 'ok') return 'ok';
  if (current === 'pending') return 'pending';
  if (test.reauthRequired) return 'reauth_required';
  return MARKS_ERROR[test.result] ? 'error' : current;
}

// 저장된 설정으로 다시 테스트하고 상태·툴 캐시를 갱신한다 (F-CON-05)
export async function retestConnector(deps: ConnectorServiceDeps, ownerId: string, id: string) {
  const { connector } = await requireConnector(deps.db, ownerId, id);
  const test = await testConnector(deps.runtimes, await savedConnector(deps, connector, ownerId));
  const now = deps.now();
  await updateConnector(deps.db, ownerId, id, {
    status: statusAfterTest(connector.status, test),
    lastTestedAt: now,
    lastTestResult: test.result,
    ...(test.result === 'ok' ? { toolsCache: test.tools, toolsCachedAt: now } : {}),
  });
  return test;
}

function patchedRemote(
  manifest: ConnectorManifest,
  current: CredentialValues,
  patch: ConnectorPatch,
): PreparedConnector {
  if (manifest.runtime !== 'remote') throw new ServiceError('invalid_request');
  const name = patch.name ?? manifest.name;
  const url = patch.url ?? manifest.url;
  const auth = patch.auth ?? manifest.auth;
  if (auth.type === 'none') {
    return { connector: remoteConnector({ name, url, auth: { type: 'none' } }), account: null };
  }
  if (auth.type !== 'static_token') throw new ServiceError('invalid_request');
  const token = ('token' in auth ? auth.token : undefined) ?? current[TOKEN_KEY];
  if (!token) throw new ServiceError('invalid_request');
  const input: RemoteConnectorInput = {
    name,
    url,
    auth: { type: 'static_token', token, header: auth.header, prefix: auth.prefix },
  };
  return { connector: remoteConnector(input), account: null };
}

// 내장 커넥터는 이름과 서비스 계정 키만 바꾼다. OAuth 재연결은 업스트림 동의를 거친다 (upstream-oauth.ts)
function patchedBuiltin(
  builtins: Builtins,
  current: RuntimeConnector,
  patch: ConnectorPatch,
): PreparedConnector {
  const { manifest } = current;
  if (manifest.runtime !== 'builtin' || patch.url !== undefined) {
    throw new ServiceError('invalid_request');
  }
  const name = patch.name ?? manifest.name;
  if (patch.auth === undefined) {
    return { connector: { ...current, manifest: { ...manifest, name } }, account: null };
  }
  if (patch.auth.type !== 'service_account') throw new ServiceError('invalid_request');
  return serviceAccountConnector(builtins, { builtin: manifest.builtin, name, auth: patch.auth });
}

// 주소·자격증명을 바꾸면 새 설정이 연결 테스트를 통과해야 저장한다 (SCR-EP-03)
export async function updateConnectorSettings(
  deps: ConnectorServiceDeps,
  ownerId: string,
  id: string,
  patch: ConnectorPatch,
): Promise<ConnectorView> {
  const { connector } = await requireConnector(deps.db, ownerId, id);
  const current = await savedConnector(deps, connector, ownerId);
  const next =
    connector.manifest.runtime === 'builtin'
      ? patchedBuiltin(deps.builtins, current, patch)
      : patchedRemote(connector.manifest, current.credentials, patch);

  if (patch.url === undefined && patch.auth === undefined) {
    await updateConnector(deps.db, ownerId, id, { manifest: next.connector.manifest });
    return getConnector(deps, ownerId, id);
  }

  const test = await testConnector(deps.runtimes, next.connector);
  if (test.result !== 'ok') throw connectionTestFailed(test.result);
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    await updateConnector(tx, ownerId, id, {
      manifest: next.connector.manifest,
      toolsCache: test.tools,
      toolsCachedAt: now,
      status: 'ok',
      lastTestedAt: now,
      lastTestResult: 'ok',
    });
    // 토큰이 그대로면 자격증명 변경 시각을 바꾸지 않는다
    const { credentials } = next.connector;
    if (JSON.stringify(credentials) === JSON.stringify(current.credentials)) return;
    await saveCredentials(
      { db: tx, secrets: deps.secrets },
      { connectorId: id, userId: ownerId },
      credentials,
      next.account,
    );
  });
  return getConnector(deps, ownerId, id);
}

export async function deleteConnector(
  deps: Pick<ConnectorServiceDeps, 'db'>,
  ownerId: string,
  id: string,
): Promise<void> {
  if (!(await deleteConnectorRow(deps.db, ownerId, id))) throw new ServiceError('not_found');
}
