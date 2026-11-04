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
const request = { redirectUri: 'https://o/cb', state: 's', nonce: 'n', codeChallenge: 'c' };

describe('OIDC client', () => {
  it('discovery를 캐시한다', async () => {
    const idp = await createFakeIdp({ now });
    const client = createOidcClient(settings, { fetch: idp.fetch, now });
    await client.authorizationUrl(request);
    await client.authorizationUrl(request);
    expect(idp.requests.filter((url) => url === FAKE_DISCOVERY_URL)).toHaveLength(1);
  });

  it('authorize URL에 PKCE S256과 prompt를 붙인다', async () => {
    const idp = await createFakeIdp({ now });
    const client = createOidcClient(settings, { fetch: idp.fetch, now });
    const url = new URL(await client.authorizationUrl({ ...request, prompt: 'login' }));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: FAKE_CLIENT_ID,
      code_challenge: 'c',
      code_challenge_method: 'S256',
      prompt: 'login',
    });
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

  it('discovery 실패를 분류값으로 돌려준다', async () => {
    const client = createOidcClient(settings, {
      fetch: async () => new Response('down', { status: 503 }),
      now,
    });
    await expect(client.endSessionUrl('https://o/admin/login')).rejects.toMatchObject({
      kind: 'discovery',
    });
  });

  it('RP-initiated logout 주소를 만들고, 없으면 null', async () => {
    const idp = await createFakeIdp({ now });
    const client = createOidcClient(settings, { fetch: idp.fetch, now });
    const url = new URL((await client.endSessionUrl('https://o/admin/login')) ?? '');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://o/admin/login');
    expect(url.searchParams.get('client_id')).toBe(FAKE_CLIENT_ID);

    const bare = await createFakeIdp({ now, endSession: false });
    const bareClient = createOidcClient(settings, { fetch: bare.fetch, now });
    expect(await bareClient.endSessionUrl('https://o/admin/login')).toBeNull();
  });
});
