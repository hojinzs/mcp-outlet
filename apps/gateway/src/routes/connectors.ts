import type { FastifyInstance } from 'fastify';
import { sessionUser } from '../http/auth-guard.ts';
import type { ConnectionTest } from '../runtimes/types.ts';
import {
  type ConnectorServiceDeps,
  deleteConnector,
  getConnector,
  getConnectorTools,
  listConnectors,
  retestConnector,
  testUnsavedConnector,
  updateRemoteConnector,
} from '../services/connectors.ts';
import { parseId, remoteConnectorInput, remoteConnectorPatch } from './inputs.ts';

// 내 커넥터 API (SCR-EP-02·03). requireSession이 걸린 /api 범위에 등록한다

export type ConnectorRouteDeps = { services: ConnectorServiceDeps; allowHttp: boolean };

// 실패하면 분류만 준다. 업스트림 본문·예외 원문은 담지 않는다 (F-RUN-03)
function testResponse(test: ConnectionTest) {
  return test.result === 'ok'
    ? { result: test.result, tools: test.tools }
    : { result: test.result };
}

export function registerConnectorRoutes(api: FastifyInstance, deps: ConnectorRouteDeps): void {
  const { services } = deps;
  const inputSchema = remoteConnectorInput(deps.allowHttp);
  const patchSchema = remoteConnectorPatch(deps.allowHttp);

  api.get('/connectors', async (request) => ({
    connectors: await listConnectors(services, sessionUser(request).id),
  }));

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
    return updateRemoteConnector(services, user.id, id, patch);
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
