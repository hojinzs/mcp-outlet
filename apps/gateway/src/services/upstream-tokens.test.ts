import { randomUUID } from 'node:crypto';
import { builtinConnectors } from '@mcp-outlet/builtin-connectors';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecretBox } from '../crypto/secrets.ts';
import { insertConnector } from '../db/queries/connectors.ts';
import { connectors, users } from '../db/schema.ts';
import { testDatabaseUrl, useTestDb } from '../testing/db.ts';
import { createFakeGoogle, FAKE_OAUTH_CLIENT, type FakeGoogle } from '../testing/fake-google.ts';
import { createOAuth2Client, TokenError } from '../upstream/oauth2.ts';
import {
  builtinManifest,
  CREDENTIAL_KEYS,
  findAuthMethod,
  serviceAccountConnector,
} from './builtin-auth.ts';
import { loadCredentials, saveCredentials } from './credentials.ts';
import { createUpstreamTokens } from './upstream-tokens.ts';

const KEY = Buffer.alloc(32, 9).toString('base64');
const google = builtinConnectors.get('google-analytics');

describe.skipIf(!testDatabaseUrl)('업스트림 access token 발급·갱신 (DB)', () => {
  const db = useTestDb();
  const secrets = createSecretBox({ current: KEY });
  let clock = new Date('2026-11-05T00:00:00Z');
  const now = () => clock;
  let fake: FakeGoogle;

  beforeAll(async () => {
    fake = await createFakeGoogle({ now });
  });

  function tokens() {
    const oauth = createOAuth2Client({ fetch: fake.fetch, timeoutMs: 3000, now });
    return createUpstreamTokens({ db, secrets, oauth, builtins: builtinConnectors, now });
  }

  // 동의를 마친 OAuth 커넥터: refresh token만 있고 access token은 아직 없다
  async function oauthConnector() {
    if (!google) throw new Error('no builtin');
    const method = findAuthMethod(google, 'oauth2');
    if (!method) throw new Error('no oauth2');
    const [user] = await db
      .insert(users)
      .values({ sub: `sub-${randomUUID()}` })
      .returning({ id: users.id });
    if (!user) throw new Error('no user');
    const manifest = builtinManifest(google, 'GA', method);
    const row = await insertConnector(db, {
      ownerId: user.id,
      runtime: 'builtin',
      manifest,
      status: 'ok',
    });
    const ref = { connectorId: row.id, userId: user.id };
    await saveCredentials({ db, secrets }, ref, {
      [CREDENTIAL_KEYS.clientId]: FAKE_OAUTH_CLIENT.clientId,
      [CREDENTIAL_KEYS.clientSecret]: FAKE_OAUTH_CLIENT.clientSecret,
      [CREDENTIAL_KEYS.refreshToken]: fake.issueRefreshToken(),
    });
    return { manifest, ref };
  }

  async function runtimeConnector(saved: Awaited<ReturnType<typeof oauthConnector>>) {
    const credentials = await loadCredentials(
      { db, secrets },
      saved.ref.connectorId,
      saved.ref.userId,
    );
    return { manifest: saved.manifest, credentials, credentialRef: saved.ref };
  }

  it('만료된 토큰은 한 번만 갱신해 저장하고, 동시 요청은 그 결과를 함께 쓴다', async () => {
    const saved = await oauthConnector();
    fake.setTokenDelay(50);
    const before = fake.stats.refreshes;
    const connector = await runtimeConnector(saved);
    const service = tokens();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.accessToken(connector)),
    );
    // 다른 인스턴스처럼 별도 서비스로 와도 저장된 토큰을 쓴다(행 잠금 뒤 다시 확인)
    const other = await tokens().accessToken(connector);
    fake.setTokenDelay(0);
    expect(new Set([...results, other]).size).toBe(1);
    expect(fake.stats.refreshes - before).toBe(1);

    const stored = await loadCredentials({ db, secrets }, saved.ref.connectorId, saved.ref.userId);
    expect(stored[CREDENTIAL_KEYS.accessToken]).toBe(results[0]);

    // 저장된 토큰이 살아 있으면 갱신하지 않는다
    expect(await tokens().accessToken(await runtimeConnector(saved))).toBe(results[0]);
    expect(fake.stats.refreshes - before).toBe(1);

    // 만료 1분 전부터는 새로 받는다
    clock = new Date(clock.getTime() + 3600_000 - 30_000);
    const renewed = await tokens().accessToken(await runtimeConnector(saved));
    expect(renewed).not.toBe(results[0]);
    expect(fake.stats.refreshes - before).toBe(2);
  });

  it('갱신이 거부되면(invalid_grant) 커넥터를 재연결 필요로 바꾼다', async () => {
    const saved = await oauthConnector();
    fake.revokeRefreshTokens();
    const error = await tokens()
      .accessToken(await runtimeConnector(saved))
      .catch((caught: unknown) => caught);
    expect(error).toEqual(new TokenError('invalid_grant'));
    const [row] = await db
      .select({ status: connectors.status })
      .from(connectors)
      .where(eq(connectors.id, saved.ref.connectorId));
    expect(row?.status).toBe('reauth_required');
  });

  it('서비스 계정: 키 파일의 token_uri는 무시하고 RS256 assertion으로 토큰을 받는다', async () => {
    const before = fake.stats.serviceAccountTokens;
    const { connector, account } = serviceAccountConnector(builtinConnectors, {
      builtin: 'google-analytics',
      name: 'GA',
      auth: { type: 'service_account', key: fake.serviceAccountKey },
    });
    expect(account).toBe('outlet@project.iam.gserviceaccount.com');
    // 저장된 값에는 client_email·private_key만 남는다
    expect(
      Object.keys(JSON.parse(connector.credentials[CREDENTIAL_KEYS.serviceAccountKey] ?? '{}')),
    ).toEqual(['clientEmail', 'privateKey']);
    const token = await tokens().accessToken(connector);
    expect(token).toMatch(/^ya29\./);
    expect(fake.stats.serviceAccountTokens - before).toBe(1);
  });
});
