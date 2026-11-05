import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { readDeniedEmail, serializeDeniedEmail } from '../auth/denied-email.ts';
import {
  codeChallengeOf,
  createLoginState,
  readLoginState,
  serializeLoginState,
} from '../auth/login-state.ts';
import { type OidcClient, OidcError } from '../auth/oidc.ts';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import {
  DENIED_EMAIL_COOKIE,
  deniedEmailCookieOptions,
  ID_TOKEN_COOKIE,
  idTokenCookieOptions,
  LOGIN_STATE_COOKIE,
  loginStateCookieOptions,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '../http/cookies.ts';
import { completeLogin } from '../services/login.ts';
import { endSession } from '../services/sessions.ts';

export type AuthRouteDeps = { config: Config; db: Db; oidc: OidcClient; now: () => Date };

// SCR-COM-02의 error 값
type LoginErrorCode = 'access_denied' | 'state_mismatch' | 'idp_error';

// prompt는 받지 않는다. Authentik에 prompt=login을 넘기면 IdP 세션이 없는 브라우저에서 로그인 흐름이
// 처음으로 되돌아가는 루프가 생겼다. "다른 계정으로 로그인"은 end_session으로 한다 (POST /auth/logout?idp=true)
const loginQuery = z.object({
  returnTo: z.string().optional(),
});

const callbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
});

const logoutQuery = z.object({ idp: z.stringbool().default(false) });

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const { config, db, oidc, now } = deps;
  const redirectUri = new URL('/auth/callback', config.PUBLIC_BASE_URL).toString();
  const loginPage = '/admin/login';

  function failLogin(reply: FastifyReply, code: LoginErrorCode) {
    return reply.redirect(`${loginPage}?error=${code}`);
  }

  // F-AUTH-02: authorization code + PKCE(S256)
  app.get('/auth/login', async (request, reply) => {
    const query = loginQuery.parse(request.query);
    const loginState = createLoginState(query.returnTo, now());
    let authorizeUrl: string;
    try {
      authorizeUrl = await oidc.authorizationUrl({
        redirectUri,
        state: loginState.state,
        nonce: loginState.nonce,
        codeChallenge: codeChallengeOf(loginState),
      });
    } catch (error) {
      if (!(error instanceof OidcError)) throw error;
      request.log.warn({ oidcError: error.kind }, 'login start failed');
      return failLogin(reply, 'idp_error');
    }
    reply.setCookie(
      LOGIN_STATE_COOKIE,
      serializeLoginState(loginState, config.SESSION_SECRET),
      loginStateCookieOptions(config),
    );
    return reply.redirect(authorizeUrl);
  });

  app.get('/auth/callback', async (request, reply) => {
    const query = callbackQuery.safeParse(request.query);
    const cookie = request.cookies[LOGIN_STATE_COOKIE];
    reply.clearCookie(LOGIN_STATE_COOKIE, loginStateCookieOptions(config));

    // IdP가 돌려준 error_description은 보여주지도 남기지도 않는다
    if (!query.success) return failLogin(reply, 'state_mismatch');
    if (query.data.error) {
      return failLogin(reply, query.data.error === 'access_denied' ? 'access_denied' : 'idp_error');
    }
    const { code, state } = query.data;
    const loginState =
      code && state ? readLoginState(cookie, config.SESSION_SECRET, state, now()) : null;
    if (!code || !loginState) return failLogin(reply, 'state_mismatch');

    let idToken: string;
    let claims: Awaited<ReturnType<OidcClient['verifyIdToken']>>;
    try {
      idToken = await oidc.exchangeCode({
        code,
        codeVerifier: loginState.codeVerifier,
        redirectUri,
      });
      claims = await oidc.verifyIdToken(idToken, loginState.nonce);
    } catch (error) {
      if (!(error instanceof OidcError)) throw error;
      request.log.warn({ oidcError: error.kind }, 'login callback failed');
      return failLogin(reply, 'idp_error');
    }
    const sub = claims.sub;
    if (!sub) return failLogin(reply, 'idp_error');

    const result = await completeLogin(
      db,
      { ...claims, sub },
      {
        policy: {
          groupsClaim: config.OIDC_GROUPS_CLAIM,
          loginGroups: config.OIDC_LOGIN_GROUPS,
          adminGroups: config.OIDC_ADMIN_GROUPS,
        },
        ttlHours: config.SESSION_TTL_HOURS,
        now: now(),
      },
    );
    // IdP 로그아웃의 id_token_hint로만 쓴다. 접근 거부(세션 없음)에서도 "다른 계정으로 로그인"에 필요하다
    reply.setCookie(ID_TOKEN_COOKIE, idToken, idTokenCookieOptions(config));
    if (result.kind === 'denied') {
      // 세션 없이 접근 거부 화면으로. 이메일은 문구에만 쓰고 주소 대신 쿠키로 넘긴다 (SCR-COM-03 not_member)
      if (result.email) {
        const value = serializeDeniedEmail(result.email, config.SESSION_SECRET, now());
        reply.setCookie(DENIED_EMAIL_COOKIE, value, deniedEmailCookieOptions(config));
      } else {
        reply.clearCookie(DENIED_EMAIL_COOKIE, deniedEmailCookieOptions(config));
      }
      return reply.redirect('/admin/forbidden?reason=not_member');
    }
    reply.clearCookie(DENIED_EMAIL_COOKIE, deniedEmailCookieOptions(config));
    reply.setCookie(SESSION_COOKIE, result.token, sessionCookieOptions(config, result.expiresAt));
    return reply.redirect(loginState.returnTo);
  });

  // 세션 없는 접근 거부 화면도 읽는다. IdP 로그아웃을 지원하지 않으면 화면이 직접 로그아웃 안내를 띄운다
  // (SCR-COM-03 결정 사항). discovery를 못 읽으면 지원하지 않는 것으로 답한다
  app.get('/auth/options', async (request) => {
    try {
      return { idpLogout: await oidc.supportsEndSession() };
    } catch (error) {
      if (!(error instanceof OidcError)) throw error;
      request.log.warn({ oidcError: error.kind }, 'idp options failed');
      return { idpLogout: false };
    }
  });

  // 접근 거부 화면(세션 없음)이 문구에 쓸 이메일. 쿠키가 없거나 만료·위조면 null
  app.get('/auth/denied', async (request) => ({
    email: readDeniedEmail(request.cookies[DENIED_EMAIL_COOKIE], config.SESSION_SECRET, now()),
  }));

  // 일반 로그아웃은 gateway 세션만, idp=true면 IdP 세션까지 끝낼 주소를 준다 (SCR-COM-01 결정 사항).
  // 세션이 없어도 성공한다. 접근 거부 화면의 "다른 계정으로 로그인"도 여기를 쓴다
  app.post('/auth/logout', async (request, reply) => {
    const query = logoutQuery.parse(request.query);
    const token = request.cookies[SESSION_COOKIE];
    if (token) await endSession(db, token);
    const idTokenHint = request.cookies[ID_TOKEN_COOKIE];
    reply.clearCookie(SESSION_COOKIE, sessionCookieOptions(config));
    reply.clearCookie(ID_TOKEN_COOKIE, idTokenCookieOptions(config));

    if (!query.idp) return { redirectTo: loginPage };
    const postLogoutRedirectUri = new URL(loginPage, config.PUBLIC_BASE_URL).toString();
    try {
      const url = await oidc.endSessionUrl({ postLogoutRedirectUri, idTokenHint });
      return { redirectTo: url ?? loginPage };
    } catch (error) {
      if (!(error instanceof OidcError)) throw error;
      request.log.warn({ oidcError: error.kind }, 'idp logout url failed');
      return { redirectTo: loginPage };
    }
  });
}
