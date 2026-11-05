import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import { sessionUser } from '../http/auth-guard.ts';
import {
  listUserConnectors,
  listUserEndpoints,
  listUsers,
  setConnectorDisabledByAdmin,
} from '../services/admin-users.ts';
import { listAudit, summarizeAudit } from '../services/audit.ts';
import { parseId } from './inputs.ts';

// 관리자 API (SCR-ADM-04·06, F-UI-02). requireSession이 걸린 /api 범위에 등록하고,
// 이 범위의 모든 요청은 requireAdmin이 매번 DB의 role을 확인한다

export type AdminRouteDeps = {
  db: Db;
  now: () => Date;
  auditRetentionDays: number;
  requireAdmin: (request: FastifyRequest) => Promise<void>;
};

const userListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  // disabled: 사용 중지한 커넥터가 있는 사용자만
  filter: z.enum(['all', 'disabled']).default('all'),
});

// 사용 중지에는 사유가 필요하다. 다시 사용할 때 사유는 적어도 되고 안 적어도 된다 (SCR-ADM-04)
const connectorDisableBody = z.discriminatedUnion('disabled', [
  z.object({ disabled: z.literal(true), reason: z.string().trim().min(1).max(200) }),
  z.object({ disabled: z.literal(false), reason: z.string().trim().min(1).max(200).optional() }),
]);

const dateTime = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const auditFilterQuery = z.object({
  from: dateTime.optional(),
  to: dateTime.optional(),
  userId: z.uuid().optional(),
  endpointId: z.uuid().optional(),
  connectorId: z.uuid().optional(),
  result: z.enum(['ok', 'error', 'denied']).optional(),
  tool: z.string().trim().min(1).max(200).optional(),
});

const auditListQuery = auditFilterQuery.extend({ cursor: z.string().max(500).optional() });

export async function registerAdminRoutes(
  api: FastifyInstance,
  deps: AdminRouteDeps,
): Promise<void> {
  await api.register(
    async (admin) => {
      admin.addHook('preHandler', deps.requireAdmin);

      admin.get('/users', async (request) => {
        const query = userListQuery.parse(request.query);
        return {
          users: await listUsers(deps, {
            query: query.q || undefined,
            disabledOnly: query.filter === 'disabled',
          }),
        };
      });

      admin.get('/users/:id/connectors', async (request) => ({
        connectors: await listUserConnectors(deps, parseId(request.params)),
      }));

      admin.get('/users/:id/endpoints', async (request) => ({
        endpoints: await listUserEndpoints(deps, parseId(request.params)),
      }));

      admin.patch('/connectors/:id', async (request) => {
        const actor = sessionUser(request);
        const id = parseId(request.params);
        const input = connectorDisableBody.parse(request.body);
        return setConnectorDisabledByAdmin(deps, actor.id, id, input);
      });

      admin.get('/audit', async (request) => {
        const { cursor, ...filter } = auditListQuery.parse(request.query);
        return listAudit(deps, filter, cursor);
      });

      admin.get('/audit/summary', async (request) =>
        summarizeAudit(
          { db: deps.db, retentionDays: deps.auditRetentionDays },
          auditFilterQuery.parse(request.query),
        ),
      );
    },
    { prefix: '/admin' },
  );
}
