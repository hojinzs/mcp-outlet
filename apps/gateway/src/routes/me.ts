import type { FastifyInstance } from 'fastify';
import { HttpError } from '../http/errors.ts';

// requireSession이 걸린 /api 범위에 등록한다 (SCR-COM-01)
export function registerMe(api: FastifyInstance): void {
  api.get('/me', async (request) => {
    const user = request.user;
    if (!user) throw new HttpError('unauthorized');
    return { id: user.id, email: user.email, role: user.role, groups: user.groups };
  });
}
