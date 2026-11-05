import { createRemoteJWKSet, customFetch, type JWTPayload, jwtVerify } from 'jose';
import { z } from 'zod';

// 표준 OIDC discovery만 쓴다. IdP별 코드를 두지 않는다 (F-AUTH-01)

const metadataSchema = z.object({
  issuer: z.string().min(1),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  jwks_uri: z.url(),
  end_session_endpoint: z.url().optional(),
});

export type OidcMetadata = z.infer<typeof metadataSchema>;

const tokenResponseSchema = z.object({ id_token: z.string().min(1) });

export type OidcErrorKind = 'discovery' | 'token_exchange' | 'id_token' | 'access_token';

// 원인 예외는 담지 않는다. 로그·응답에는 kind만 쓴다
export class OidcError extends Error {
  readonly kind: OidcErrorKind;

  constructor(kind: OidcErrorKind) {
    super(`oidc ${kind} failed`);
    this.name = 'OidcError';
    this.kind = kind;
  }
}

export type OidcSettings = {
  discoveryUrl: string;
  clientId: string;
  clientSecret?: string | undefined;
};

export type OidcDeps = {
  fetch: typeof fetch;
  now: () => Date;
};

export type AuthorizationRequest = {
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
};

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
// Authentik 토큰 교환이 dev에서 10초를 넘긴 적이 있어 업스트림 기본 타임아웃과 맞춘다
const REQUEST_TIMEOUT_MS = 30_000;
const CLOCK_TOLERANCE_SECONDS = 30;

export function createOidcClient(settings: OidcSettings, deps: OidcDeps) {
  let cached:
    | { metadata: OidcMetadata; jwks: ReturnType<typeof createRemoteJWKSet>; loadedAt: number }
    | undefined;

  async function load() {
    const now = deps.now().getTime();
    if (cached && now - cached.loadedAt < DISCOVERY_TTL_MS) return cached;
    try {
      const res = await deps.fetch(settings.discoveryUrl, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error('discovery status');
      const metadata = metadataSchema.parse(await res.json());
      const jwks = createRemoteJWKSet(new URL(metadata.jwks_uri), {
        [customFetch]: deps.fetch,
        timeoutDuration: REQUEST_TIMEOUT_MS,
      });
      cached = { metadata, jwks, loadedAt: now };
      return cached;
    } catch {
      throw new OidcError('discovery');
    }
  }

  async function authorizationUrl(request: AuthorizationRequest): Promise<string> {
    const { metadata } = await load();
    const url = new URL(metadata.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: settings.clientId,
      redirect_uri: request.redirectUri,
      scope: 'openid email profile',
      state: request.state,
      nonce: request.nonce,
      code_challenge: request.codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  // 코드를 교환해 id_token을 받는다. access_token은 관리 UI 로그인에 쓰지 않는다
  async function exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<string> {
    const { metadata } = await load();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
      client_id: settings.clientId,
    });
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    };
    if (settings.clientSecret) headers.authorization = basicAuth(settings);
    try {
      const res = await deps.fetch(metadata.token_endpoint, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error('token status');
      return tokenResponseSchema.parse(await res.json()).id_token;
    } catch {
      throw new OidcError('token_exchange');
    }
  }

  // 서명·iss·aud·exp와 로그인 요청 때 만든 nonce를 확인한다
  async function verifyIdToken(idToken: string, nonce: string): Promise<JWTPayload> {
    const { metadata, jwks } = await load();
    try {
      const { payload } = await jwtVerify(idToken, jwks, {
        issuer: metadata.issuer,
        audience: settings.clientId,
        currentDate: deps.now(),
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['sub', 'exp', 'nonce'],
      });
      if (payload.nonce !== nonce) throw new Error('nonce');
      return payload;
    } catch {
      throw new OidcError('id_token');
    }
  }

  // MCP 요청의 Bearer JWT: 서명·iss·aud·exp (F-AUTH-03). aud는 OIDC_AUDIENCE와 비교한다
  async function verifyAccessToken(
    token: string,
    audience: string,
  ): Promise<JWTPayload & { sub: string }> {
    const { metadata, jwks } = await load();
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: metadata.issuer,
        audience,
        currentDate: deps.now(),
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['sub', 'exp'],
      });
      if (typeof payload.sub !== 'string' || payload.sub === '') throw new Error('sub');
      return { ...payload, sub: payload.sub };
    } catch {
      throw new OidcError('access_token');
    }
  }

  // 보호 리소스 메타데이터의 authorization_servers (F-AUTH-04)
  async function issuer(): Promise<string> {
    return (await load()).metadata.issuer;
  }

  // RP-initiated logout. IdP가 지원하지 않으면 null (SCR-COM-03 결정 사항).
  // post_logout_redirect_uri는 id_token_hint가 있을 때만 붙인다. 등록된 로그아웃 URI가 있는 IdP는
  // hint 없는 post_logout_redirect_uri를 거부한다(OIDC RP-Initiated Logout 1.0)
  async function endSessionUrl(input: {
    postLogoutRedirectUri: string;
    idTokenHint?: string | undefined;
  }): Promise<string | null> {
    const { metadata } = await load();
    if (!metadata.end_session_endpoint) return null;
    const url = new URL(metadata.end_session_endpoint);
    url.searchParams.set('client_id', settings.clientId);
    if (input.idTokenHint) {
      url.searchParams.set('id_token_hint', input.idTokenHint);
      url.searchParams.set('post_logout_redirect_uri', input.postLogoutRedirectUri);
    }
    return url.toString();
  }

  return {
    authorizationUrl,
    exchangeCode,
    verifyIdToken,
    verifyAccessToken,
    issuer,
    endSessionUrl,
  };
}

export type OidcClient = ReturnType<typeof createOidcClient>;

// RFC 6749 2.3.1: id·secret을 form-urlencode한 뒤 Basic으로 묶는다
function basicAuth(settings: OidcSettings): string {
  const encode = (value: string) => encodeURIComponent(value).replace(/%20/g, '+');
  const pair = `${encode(settings.clientId)}:${encode(settings.clientSecret ?? '')}`;
  return `Basic ${Buffer.from(pair).toString('base64')}`;
}
