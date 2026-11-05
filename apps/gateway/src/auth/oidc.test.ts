import { describe, expect, it } from 'vitest';
import { pkceChallenge } from '../crypto/tokens.ts';
import {
  createFakeIdp,
  FAKE_CLIENT_ID,
  FAKE_CLIENT_SECRET,
  FAKE_DISCOVERY_URL,
} from '../testing/fake-idp.ts';
import { createOidcClient, OidcError } from './oidc.ts';

const now = () => new Date('2026-11-04T00:00:00Z');
const settings = {
  discoveryUrl: FAKE_DISCOVERY_URL,
  clientId: FAKE_CLIENT_ID,
  clientSecret: FAKE_CLIENT_SECRET,
};
const logout = { postLogoutRedirectUri: 'https://o/admin/login' };
const request = { redirectUri: 'https://o/cb', state: 's', nonce: 'n', codeChallenge: 'c' };

describe('OIDC client', () => {
  it('discovery를 캐시한다', async () => {
    const idp = await createFakeIdp({ now });
    const client = createOidcClient(settings, { fetch: idp.fetch, now });
    await client.authorizationUrl(request);
    await client.authorizationUrl(request);
    expect(idp.requests.filter((url) => url === FAKE_DISCOVERY_URL)).toHaveLength(1);
  });

  it('authorize URL에 PKCE S256을 붙인다', async () => {
    const idp = await createFakeIdp({ now });
    const client = createOidcClient(settings, { fetch: idp.fetch, now });
    const url = new URL(await client.authorizationUrl(request));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: FAKE_CLIENT_ID,
      code_challenge: 'c',
      code_challenge_method: 'S256',
    });
    expect(url.searchParams.has('prompt')).toBe(false);
  });

  it('PKCE verifier와 client secret으로 코드를 교환한다', async () => {
    const idp = await createFakeIdp({ now });
    const client = createOidcClient(settings, { fetch: idp.fetch, now });
    const verifier = 'v'.repeat(43);
    const url = await client.authorizationUrl({
      ...request,
      codeChallenge: pkceChallenge(verifier),
    });
    const code = idp.authorize(url, { sub: 'u1' });
    const idToken = await client.exchangeCode({
      code,
      codeVerifier: verifier,
      redirectUri: 'https://o/cb',
    });
    await expect(client.verifyIdToken(idToken, 'n')).resolves.toMatchObject({ sub: 'u1' });
    await expect(
      client.exchangeCode({ code, codeVerifier: verifier, redirectUri: 'https://o/cb' }),
    ).rejects.toMatchObject({ kind: 'token_exchange' });
  });

  it('id_token의 iss·aud·nonce를 확인한다', async () => {
    const idp = await createFakeIdp({ now });
    const client = createOidcClient(settings, { fetch: idp.fetch, now });
    const good = await idp.signIdToken({ sub: 'u1', nonce: 'n' });
    await expect(client.verifyIdToken(good, 'n')).resolves.toMatchObject({ sub: 'u1' });
    await expect(client.verifyIdToken(good, 'other')).rejects.toBeInstanceOf(OidcError);
    const wrongAud = await idp.signIdToken({ sub: 'u1', nonce: 'n' }, { aud: 'someone-else' });
    await expect(client.verifyIdToken(wrongAud, 'n')).rejects.toBeInstanceOf(OidcError);
    const wrongIss = await idp.signIdToken({ sub: 'u1', nonce: 'n' }, { iss: 'https://evil' });
    await expect(client.verifyIdToken(wrongIss, 'n')).rejects.toBeInstanceOf(OidcError);
  });

  it('만료된 id_token을 거부한다', async () => {
    const idp = await createFakeIdp({ now });
    const token = await idp.signIdToken({ sub: 'u1', nonce: 'n' });
    const later = () => new Date(now().getTime() + 60 * 60 * 1000);
    const client = createOidcClient(settings, { fetch: idp.fetch, now: later });
    await expect(client.verifyIdToken(token, 'n')).rejects.toMatchObject({ kind: 'id_token' });
  });

  it('access token: 서명·iss·aud·exp를 확인하고 aud는 지정한 값과 비교한다', async () => {
    const idp = await createFakeIdp({ now });
    const client = createOidcClient(settings, { fetch: idp.fetch, now });
    const good = await idp.signAccessToken({ sub: 'u1' });
    await expect(client.verifyAccessToken(good, FAKE_CLIENT_ID)).resolves.toMatchObject({
      sub: 'u1',
    });
    await expect(client.verifyAccessToken(good, 'https://other-audience')).rejects.toMatchObject({
      kind: 'access_token',
    });
    const wrongIss = await idp.signAccessToken({ sub: 'u1' }, { iss: 'https://evil' });
    await expect(client.verifyAccessToken(wrongIss, FAKE_CLIENT_ID)).rejects.toBeInstanceOf(
      OidcError,
    );
    // 같은 kid라도 다른 키로 서명하면 거부한다
    const forger = await createFakeIdp({ now });
    const forged = await forger.signAccessToken({ sub: 'u1' });
    await expect(client.verifyAccessToken(forged, FAKE_CLIENT_ID)).rejects.toBeInstanceOf(
      OidcError,
    );
    const noSub = await idp.signAccessToken({});
    await expect(client.verifyAccessToken(noSub, FAKE_CLIENT_ID)).rejects.toBeInstanceOf(OidcError);
    const later = () => new Date(now().getTime() + 60 * 60 * 1000);
    const expired = createOidcClient(settings, { fetch: idp.fetch, now: later });
    await expect(expired.verifyAccessToken(good, FAKE_CLIENT_ID)).rejects.toBeInstanceOf(OidcError);
    // 같은 IdP·aud의 id_token은 scope가 없어 MCP Bearer로 받지 않는다
    const idToken = await idp.signIdToken({ sub: 'u1', nonce: 'n' });
    await expect(client.verifyAccessToken(idToken, FAKE_CLIENT_ID)).rejects.toBeInstanceOf(
      OidcError,
    );
    const scp = await idp.signIdToken({ sub: 'u1', scp: ['openid'] });
    await expect(client.verifyAccessToken(scp, FAKE_CLIENT_ID)).resolves.toMatchObject({
      sub: 'u1',
    });
    await expect(client.issuer()).resolves.toBe('https://idp.test/app');
  });

  it('discovery 실패를 분류값으로 돌려준다', async () => {
    const client = createOidcClient(settings, {
      fetch: async () => new Response('down', { status: 503 }),
      now,
    });
    await expect(client.endSessionUrl(logout)).rejects.toMatchObject({ kind: 'discovery' });
  });

  it('RP-initiated logout: hint가 있을 때만 돌아올 주소를 붙인다', async () => {
    const idp = await createFakeIdp({ now });
    const client = createOidcClient(settings, { fetch: idp.fetch, now });
    const withHint = new URL(
      (await client.endSessionUrl({ ...logout, idTokenHint: 'id.token.hint' })) ?? '',
    );
    expect(Object.fromEntries(withHint.searchParams)).toEqual({
      client_id: FAKE_CLIENT_ID,
      id_token_hint: 'id.token.hint',
      post_logout_redirect_uri: 'https://o/admin/login',
    });
    const bareUrl = new URL((await client.endSessionUrl(logout)) ?? '');
    expect(Object.fromEntries(bareUrl.searchParams)).toEqual({ client_id: FAKE_CLIENT_ID });
  });

  it('end_session_endpoint가 없으면 null', async () => {
    const bare = await createFakeIdp({ now, endSession: false });
    const bareClient = createOidcClient(settings, { fetch: bare.fetch, now });
    expect(await bareClient.endSessionUrl(logout)).toBeNull();
  });
});
