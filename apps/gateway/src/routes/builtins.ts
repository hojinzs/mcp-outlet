import type { FastifyInstance } from 'fastify';
import { sessionUser } from '../http/auth-guard.ts';
import { type Builtins, builtinCatalog } from '../services/builtin-auth.ts';

// 내장 서비스 목록 (SCR-EP-02). requireSession이 걸린 /api 범위에 등록한다
export function registerBuiltinRoutes(
  api: FastifyInstance,
  deps: { builtins: Builtins; redirectUri: string },
): void {
  api.get('/builtins', async (request) => {
    sessionUser(request);
    return { builtins: builtinCatalog(deps.builtins, deps.redirectUri) };
  });
}
