import { createHash } from 'node:crypto';
import { exportPKCS8, generateKeyPair, jwtVerify, UnsecuredJWT } from 'jose';
import { randomToken } from '../crypto/tokens.ts';

// 가짜 Google: OAuth 토큰 엔드포인트(코드 교환·갱신·서비스 계정 JWT bearer)와 GA4·Search Console API를
// fetch 하나로 흉내 낸다. 내장 커넥터 테스트에서 apiFetch로 주입한다

export const FAKE_OAUTH_CLIENT = { clientId: 'google-client', clientSecret: 'google-secret' };
export const FAKE_GOOGLE_EMAIL = 'owner@example.com';
export const FAKE_SERVICE_ACCOUNT_EMAIL = 'outlet@project.iam.gserviceaccount.com';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

type PendingCode = { codeChallenge: string; redirectUri: string; clientId: string };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function createFakeGoogle(options: { now: () => Date }) {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const serviceAccountKey = JSON.stringify({
    type: 'service_account',
    project_id: 'project',
    client_email: FAKE_SERVICE_ACCOUNT_EMAIL,
    private_key: await exportPKCS8(privateKey),
    token_uri: 'https://attacker.invalid/token',
  });

  const codes = new Map<string, PendingCode>();
  const refreshTokens = new Set<string>();
  const accessTokens = new Map<string, number>();
  const stats = { refreshes: 0, serviceAccountTokens: 0, apiCalls: [] as string[] };
  // 갱신 경합을 재현하려고 토큰 응답을 늦출 수 있다
  let tokenDelayMs = 0;

  function issueRefresh(): string {
    const token = `1//${randomToken()}`;
    refreshTokens.add(token);
    return token;
  }

  function issueAccess(): { access_token: string; expires_in: number } {
    const token = `ya29.${randomToken()}`;
    accessTokens.set(token, options.now().getTime() + 3600_000);
    return { access_token: token, expires_in: 3600 };
  }

  // 사용자가 동의 화면에서 허용한 것처럼 authorize URL에 대한 코드를 만든다
  function consent(authorizationUrl: string): string {
    const params = new URL(authorizationUrl).searchParams;
    const code = randomToken();
    codes.set(code, {
      codeChallenge: params.get('code_challenge') ?? '',
      redirectUri: params.get('redirect_uri') ?? '',
      clientId: params.get('client_id') ?? '',
    });
    return code;
  }

  function validClient(form: URLSearchParams): boolean {
    return (
      form.get('client_id') === FAKE_OAUTH_CLIENT.clientId &&
      form.get('client_secret') === FAKE_OAUTH_CLIENT.clientSecret
    );
  }

  async function handleToken(form: URLSearchParams): Promise<Response> {
    if (tokenDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, tokenDelayMs));
    const grantType = form.get('grant_type');
    if (grantType === 'authorization_code') {
      const pending = codes.get(form.get('code') ?? '');
      codes.delete(form.get('code') ?? '');
      const verifier = form.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (!validClient(form)) return json({ error: 'invalid_client' }, 401);
      if (
        !pending ||
        pending.codeChallenge !== challenge ||
        pending.redirectUri !== form.get('redirect_uri')
      ) {
        return json({ error: 'invalid_grant' }, 400);
      }
      const refreshToken = issueRefresh();
      const idToken = new UnsecuredJWT({ email: FAKE_GOOGLE_EMAIL }).encode();
      return json({ ...issueAccess(), refresh_token: refreshToken, id_token: idToken });
    }
    if (grantType === 'refresh_token') {
      if (!validClient(form)) return json({ error: 'invalid_client' }, 401);
      if (!refreshTokens.has(form.get('refresh_token') ?? '')) {
        return json(
          { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
          400,
        );
      }
      stats.refreshes += 1;
      return json(issueAccess());
    }
    if (grantType === 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
      try {
        const { payload } = await jwtVerify(form.get('assertion') ?? '', publicKey, {
          issuer: FAKE_SERVICE_ACCOUNT_EMAIL,
          audience: TOKEN_URL,
          // assertion은 테스트 시계로 서명되므로 같은 시계로 검사한다
          currentDate: options.now(),
        });
        if (typeof payload.scope !== 'string' || !payload.scope.includes('analytics.readonly')) {
          return json({ error: 'invalid_scope' }, 400);
        }
      } catch {
        return json({ error: 'invalid_grant' }, 400);
      }
      stats.serviceAccountTokens += 1;
      return json(issueAccess());
    }
    return json({ error: 'unsupported_grant_type' }, 400);
  }

  function handleApi(url: URL, init: RequestInit | undefined): Response {
    const token = new Headers(init?.headers).get('authorization')?.replace(/^Bearer /, '') ?? '';
    const expiresAt = accessTokens.get(token);
    if (!expiresAt || expiresAt <= options.now().getTime()) {
      return json({ error: { code: 401, status: 'UNAUTHENTICATED' } }, 401);
    }
    stats.apiCalls.push(`${url.hostname}${url.pathname}`);
    if (url.pathname === '/v1beta/accountSummaries') {
      return json({
        accountSummaries: [
          {
            account: 'accounts/1',
            displayName: 'Daniworks',
            propertySummaries: [{ property: 'properties/123', displayName: 'Home' }],
          },
        ],
      });
    }
    if (url.pathname === '/v1beta/properties/123:runReport') {
      return json({
        dimensionHeaders: [{ name: 'date' }],
        metricHeaders: [{ name: 'sessions', type: 'TYPE_INTEGER' }],
        rows: [{ dimensionValues: [{ value: '20261101' }], metricValues: [{ value: '7' }] }],
        rowCount: 1,
      });
    }
    return json({ error: { code: 404, status: 'NOT_FOUND' } }, 404);
  }

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.toString() === TOKEN_URL) return handleToken(new URLSearchParams(String(init?.body)));
    return handleApi(url, init);
  }) as typeof globalThis.fetch;

  return {
    fetch,
    consent,
    serviceAccountKey,
    stats,
    // 이미 동의를 마친 계정의 refresh token
    issueRefreshToken: issueRefresh,
    // 사용자가 Google 계정에서 앱 접근을 취소한 상황
    revokeRefreshTokens: () => refreshTokens.clear(),
    setTokenDelay: (ms: number) => {
      tokenDelayMs = ms;
    },
  };
}

export type FakeGoogle = Awaited<ReturnType<typeof createFakeGoogle>>;
