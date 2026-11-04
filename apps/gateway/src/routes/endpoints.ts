import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sessionUser } from '../http/auth-guard.ts';
import {
  createEndpoint,
  deleteEndpoint,
  type EndpointServiceDeps,
  getConnectInfo,
  getEndpoint,
  listEndpointCalls,
  listEndpoints,
  updateEndpoint,
} from '../services/endpoints.ts';
import { displayName, newConnectorInput, parseId, toolNameList } from './inputs.ts';

// 내 엔드포인트 API (SCR-EP-01~04). requireSession이 걸린 /api 범위에 등록한다

export type EndpointRouteDeps = {
  services: EndpointServiceDeps;
  allowHttp: boolean;
  oauthClient: { clientId: string; hasClientSecret: boolean };
};

const patchSchema = z.object({
  name: displayName.optional(),
  allowedTools: toolNameList.optional(),
  enabled: z.boolean().optional(),
  acknowledgeNewTools: z.literal(true).optional(),
});

const deleteQuery = z.object({ deleteConnector: z.stringbool().default(false) });

export function registerEndpointRoutes(api: FastifyInstance, deps: EndpointRouteDeps): void {
  const { services } = deps;
  // 기존 커넥터(connectorId)나 새 커넥터 설정(connector: 원격·서비스 계정 내장) 중 하나
  const createSchema = z.union([
    z.object({ name: displayName, allowedTools: toolNameList, connectorId: z.uuid() }),
    z.object({
      name: displayName,
      allowedTools: toolNameList,
      connector: newConnectorInput(deps.allowHttp),
    }),
  ]);

  api.get('/endpoints', async (request) => ({
    endpoints: await listEndpoints(services, sessionUser(request).id),
  }));

  api.post('/endpoints', async (request, reply) => {
    const user = sessionUser(request);
    const input = createSchema.parse(request.body);
    return reply.code(201).send(await createEndpoint(services, user.id, input));
  });

  api.get('/endpoints/:id', async (request) =>
    getEndpoint(services, sessionUser(request).id, parseId(request.params)),
  );

  api.patch('/endpoints/:id', async (request) => {
    const user = sessionUser(request);
    const id = parseId(request.params);
    return updateEndpoint(services, user.id, id, patchSchema.parse(request.body));
  });

  api.delete('/endpoints/:id', async (request) => {
    const user = sessionUser(request);
    const id = parseId(request.params);
    const query = deleteQuery.parse(request.query);
    return deleteEndpoint(services, user.id, id, query);
  });

  api.get('/endpoints/:id/calls', async (request) => ({
    calls: await listEndpointCalls(services, sessionUser(request).id, parseId(request.params)),
  }));

  api.get('/endpoints/:id/connect-info', async (request) =>
    getConnectInfo(services, sessionUser(request).id, parseId(request.params), deps.oauthClient),
  );
}
