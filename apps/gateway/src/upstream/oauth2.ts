import { decodeJwt, importPKCS8, SignJWT } from 'jose';
import { z } from 'zod';

// 내장 커넥터의 업스트림 토큰 엔드포인트 호출 (F-CON-03).
// 주소는 내장 커넥터 정의에서만 온다. 응답 본문·원문 예외는 밖으로 내보내지 않는다

// invalid_grant: refresh token이 만료·폐기됨 → 사용자가 다시 연결해야 한다
// key_rejected: 서비스 계정 키가 지워졌거나 깨짐 → 키 파일을 바꿔야 한다(다시 연결할 것이 없다)
export type TokenErrorKind =
  | 'invalid_grant'
  | 'key_rejected'
  | 'timeout'
  | 'unreachable'
  | 'token_error';

export class TokenError extends Error {
  readonly kind: TokenErrorKind;

  constructor(kind: TokenErrorKind) {
    super(`upstream token ${kind}`);
    this.name = 'TokenError';
    this.kind = kind;
  }
}

export type TokenResponse = {
  accessToken: string;
  expiresAt: number;
  refreshToken: string | undefined;
  // id_token이 있으면 그 email 클레임 (연결된 계정 표시용)
  email: string | undefined;
};

export type OAuth2ClientDeps = { fetch: typeof fetch; timeoutMs: number; now: () => Date };

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().positive().default(3600),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().optional(),
});

// 다시 시도해도 같은 결과인 오류. invalid_client는 사용자가 OAuth 앱을 지웠거나 secret을 바꾼 경우다
const REAUTH_ERRORS = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client']);

// 서명 검증 없이 email만 읽는다. TLS로 토큰 엔드포인트에서 직접 받은 값이다 (OIDC Core 3.1.3.7)
function emailOf(idToken: string | undefined): string | undefined {
  if (!idToken) return undefined;
  try {
    const email = decodeJwt(idToken).email;
    return typeof email === 'string' ? email : undefined;
  } catch {
    return undefined;
  }
}

async function errorKind(response: Response): Promise<TokenErrorKind> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && REAUTH_ERRORS.has(body.error)) return 'invalid_grant';
  } catch {
    // 본문이 JSON이 아니면 분류할 수 없다
  }
  return 'token_error';
}

export function createOAuth2Client(deps: OAuth2ClientDeps) {
  async function requestToken(tokenUrl: string, form: Record<string, string>) {
    let response: Response;
    try {
      response = await deps.fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams(form),
        redirect: 'error',
        signal: AbortSignal.timeout(deps.timeoutMs),
      });
    } catch (error) {
      throw new TokenError((error as Error)?.name === 'TimeoutError' ? 'timeout' : 'unreachable');
    }
    if (!response.ok) throw new TokenError(await errorKind(response));
    let parsed: z.infer<typeof tokenResponseSchema>;
    try {
      parsed = tokenResponseSchema.parse(await response.json());
    } catch {
      throw new TokenError('token_error');
    }
    return {
      accessToken: parsed.access_token,
      expiresAt: deps.now().getTime() + parsed.expires_in * 1000,
      refreshToken: parsed.refresh_token,
      email: emailOf(parsed.id_token),
    } satisfies TokenResponse;
  }

  return {
    exchangeCode(
      tokenUrl: string,
      input: {
        code: string;
        codeVerifier: string;
        redirectUri: string;
        clientId: string;
        clientSecret: string;
      },
    ) {
      return requestToken(tokenUrl, {
        grant_type: 'authorization_code',
        code: input.code,
        code_verifier: input.codeVerifier,
        redirect_uri: input.redirectUri,
        client_id: input.clientId,
        client_secret: input.clientSecret,
      });
    },

    refresh(
      tokenUrl: string,
      input: { refreshToken: string; clientId: string; clientSecret: string },
    ) {
      return requestToken(tokenUrl, {
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
        client_id: input.clientId,
        client_secret: input.clientSecret,
      });
    },

    // 서비스 계정: RS256으로 서명한 assertion을 access token으로 바꾼다 (RFC 7523)
    async serviceAccountToken(
      tokenUrl: string,
      input: { clientEmail: string; privateKey: string; scopes: readonly string[] },
    ) {
      let assertion: string;
      try {
        const key = await importPKCS8(input.privateKey, 'RS256');
        const issuedAt = Math.floor(deps.now().getTime() / 1000);
        assertion = await new SignJWT({ scope: input.scopes.join(' ') })
          .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
          .setIssuer(input.clientEmail)
          .setAudience(tokenUrl)
          .setIssuedAt(issuedAt)
          .setExpirationTime(issuedAt + 3600)
          .sign(key);
      } catch {
        // 키 형식이 깨졌으면 키를 새로 넣어야 한다
        throw new TokenError('key_rejected');
      }
      try {
        return await requestToken(tokenUrl, {
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        });
      } catch (error) {
        // 서비스 계정 assertion 거부는 키를 지웠거나 계정이 사라진 경우다
        if (error instanceof TokenError && error.kind === 'invalid_grant') {
          throw new TokenError('key_rejected');
        }
        throw error;
      }
    },
  };
}

export type OAuth2Client = ReturnType<typeof createOAuth2Client>;
