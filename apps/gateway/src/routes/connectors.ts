import type { FastifyInstance } from 'fastify';
import { sealUpstreamState } from '../auth/upstream-state.ts';
import type { Config } from '../config.ts';
import { sessionUser } from '../http/auth-guard.ts';
import { UPSTREAM_STATE_COOKIE, upstreamStateCookieOptions } from '../http/cookies.ts';
import type { ConnectionTest } from '../runtimes/types.ts';
import {
  deleteConnector,
  getConnector,
  getConnectorTools,
  listConnectors,
  retestConnector,
  testUnsavedConnector,
  updateConnectorSettings,
} from '../services/connectors.ts';
import {
  createOAuthConnector,
  startUpstreamOAuth,
  type UpstreamOAuthDeps,
} from '../services/upstream-oauth.ts';
import {
  connectorPatch,
  newConnectorInput,
  oauthConnectorInput,
  oauthStartInput,
  parseId,
} from './inputs.ts';

// 내 커넥터 API (SCR-EP-02·03). requireSession이 걸린 /api 범위에 등록한다

export type ConnectorRouteDeps = {
  services: UpstreamOAuthDeps;
  config: Config;
  allowHttp: boolean;
};

// 실패하면 분류만 준다. 업스트림 본문·예외 원문은 담지 않는다 (F-RUN-03)
function testResponse(test: ConnectionTest) {
  return test.result === 'ok'
    ? { result: test.result, tools: test.tools }
    : { result: test.result };
}

export function registerConnectorRoutes(api: FastifyInstance, deps: ConnectorRouteDeps): void {
  const { services } = deps;
  const inputSchema = newConnectorInput(deps.allowHttp);
  const patchSchema = connectorPatch(deps.allowHttp);

  api.get('/connectors', async (request) => ({
    connectors: await listConnectors(services, sessionUser(request).id),
  }));

  // 업스트림 OAuth 내장 커넥터를 동의 전에 "연결 중"으로 저장한다 (SCR-EP-02 계정 연결 순서)
  api.post('/connectors', async (request, reply) => {
    const user = sessionUser(request);
    const input = oauthConnectorInput.parse(request.body);
    return reply.code(201).send(await createOAuthConnector(services, user.id, input));
  });

  // 동의 화면 주소를 주고, 콜백까지 쓸 state·PKCE는 암호화한 쿠키에 담는다
  api.post('/connectors/:id/oauth/start', async (request, reply) => {
    const user = sessionUser(request);
    const id = parseId(request.params);
    const input = oauthStartInput.parse(request.body ?? {});
    const { authorizationUrl, state } = await startUpstreamOAuth(services, user.id, id, input);
    reply.setCookie(
      UPSTREAM_STATE_COOKIE,
      sealUpstreamState(state, services.secrets),
      upstreamStateCookieOptions(deps.config),
    );
    return { authorizationUrl };
  });

  // 저장하지 않은 설정으로 연결 테스트. 토큰은 저장·기록하지 않는다
  api.post('/connectors/test', async (request) => {
    sessionUser(request);
    const input = inputSchema.parse(request.body);
    return testResponse(await testUnsavedConnector(services, input));
  });

  api.get('/connectors/:id', async (request) =>
    getConnector(services, sessionUser(request).id, parseId(request.params)),
  );

  api.get('/connectors/:id/tools', async (request) =>
    getConnectorTools(services, sessionUser(request).id, parseId(request.params)),
  );

  api.patch('/connectors/:id', async (request) => {
    const user = sessionUser(request);
    const id = parseId(request.params);
    const patch = patchSchema.parse(request.body);
    return updateConnectorSettings(services, user.id, id, patch);
  });

  api.post('/connectors/:id/test', async (request) => {
    const user = sessionUser(request);
    return testResponse(await retestConnector(services, user.id, parseId(request.params)));
  });

  api.delete('/connectors/:id', async (request, reply) => {
    await deleteConnector(services, sessionUser(request).id, parseId(request.params));
    return reply.code(204).send();
  });
}
