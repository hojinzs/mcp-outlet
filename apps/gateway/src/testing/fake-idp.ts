import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';
import { pkceChallenge, randomToken } from '../crypto/tokens.ts';

export const FAKE_ISSUER = 'https://idp.test/app';
export const FAKE_DISCOVERY_URL = `${FAKE_ISSUER}/.well-known/openid-configuration`;
export const FAKE_CLIENT_ID = 'outlet-test';
export const FAKE_CLIENT_SECRET = 'outlet-test-secret';

type PendingCode = {
  claims: JWTPayload;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
};

// jose로 만든 테스트 JWKS와 discovery·token 엔드포인트를 fetch로 흉내 낸다
export async function createFakeIdp(options: { now: () => Date; endSession?: boolean }) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, PendingCode>();
  const requests: string[] = [];

  const metadata = {
    issuer: FAKE_ISSUER,
    authorization_endpoint: `${FAKE_ISSUER}/authorize`,
    token_endpoint: `${FAKE_ISSUER}/token`,
    jwks_uri: `${FAKE_ISSUER}/jwks`,
    ...(options.endSession === false ? {} : { end_session_endpoint: `${FAKE_ISSUER}/end-session` }),
  };

  async function signIdToken(claims: JWTPayload, overrides: { iss?: string; aud?: string } = {}) {
    const iat = Math.floor(options.now().getTime() / 1000);
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(overrides.iss ?? FAKE_ISSUER)
      .setAudience(overrides.aud ?? FAKE_CLIENT_ID)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 300)
      .sign(privateKey);
  }

  // MCP Bearer용 access token. 실제 Authentik access token처럼 scope·azp가 있다 (id_token에는 없다)
  async function signAccessToken(
    claims: JWTPayload,
    overrides: { iss?: string; aud?: string } = {},
  ) {
    return signIdToken(
      { scope: 'openid email profile', azp: FAKE_CLIENT_ID, ...claims },
      overrides,
    );
  }

  // 사용자가 IdP에서 로그인을 마친 것처럼 authorize URL에 대한 코드를 만든다
  function authorize(authorizeUrl: string, claims: JWTPayload): string {
    const params = new URL(authorizeUrl).searchParams;
    const code = randomToken();
    codes.set(code, {
      claims,
      nonce: params.get('nonce') ?? '',
      codeChallenge: params.get('code_challenge') ?? '',
      redirectUri: params.get('redirect_uri') ?? '',
    });
    return code;
  }

  async function handleToken(init: RequestInit | undefined): Promise<Response> {
    const credentials = Buffer.from(`${FAKE_CLIENT_ID}:${FAKE_CLIENT_SECRET}`).toString('base64');
    const headers = new Headers(init?.headers);
    const body = new URLSearchParams(String(init?.body ?? ''));
    const code = body.get('code') ?? '';
    const pending = codes.get(code);
    codes.delete(code);
    const valid =
      pending &&
      headers.get('authorization') === `Basic ${credentials}` &&
      body.get('grant_type') === 'authorization_code' &&
      body.get('redirect_uri') === pending.redirectUri &&
      pkceChallenge(body.get('code_verifier') ?? '') === pending.codeChallenge;
    if (!valid) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    const idToken = await signIdToken({ ...pending.claims, nonce: pending.nonce });
    return Response.json({ id_token: idToken, access_token: 'unused', token_type: 'Bearer' });
  }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push(url);
    if (url === FAKE_DISCOVERY_URL) return Response.json(metadata);
    if (url === metadata.jwks_uri) return Response.json({ keys: [jwk] });
    if (url === metadata.token_endpoint) return handleToken(init);
    return new Response('not found', { status: 404 });
  };

  return { fetch, authorize, signIdToken, signAccessToken, requests };
}
