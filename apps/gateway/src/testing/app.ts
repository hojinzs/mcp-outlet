import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.ts';
import type { Db } from '../db/client.ts';
import { users } from '../db/schema.ts';
import { createSession } from '../services/sessions.ts';
import { testDatabaseUrl } from './db.ts';
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, FAKE_DISCOVERY_URL } from './fake-idp.ts';

export const TEST_GROUPS = { users: 'Outlet Users', admins: 'Outlet Admins' };

export function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    PUBLIC_BASE_URL: 'https://outlet.test',
    DATABASE_URL: testDatabaseUrl ?? 'postgres://unused',
    OIDC_DISCOVERY_URL: FAKE_DISCOVERY_URL,
    OIDC_CLIENT_ID: FAKE_CLIENT_ID,
    OIDC_CLIENT_SECRET: FAKE_CLIENT_SECRET,
    OIDC_LOGIN_GROUPS: `${TEST_GROUPS.users},${TEST_GROUPS.admins}`,
    OIDC_ADMIN_GROUPS: TEST_GROUPS.admins,
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    SESSION_SECRET: 's'.repeat(32),
    UPSTREAM_ALLOW_CIDRS: '127.0.0.1/32',
    UPSTREAM_TIMEOUT_MS: '3000',
    LOG_LEVEL: 'fatal',
    ...overrides,
  });
}

// 로그인을 마친 사용자처럼 사용자 행과 세션을 바로 만든다. 쿠키 값과 사용자를 돌려준다
export async function createLoggedInUser(db: Db, now = new Date()) {
  const sub = `sub-${randomUUID()}`;
  const [user] = await db
    .insert(users)
    .values({ sub, email: `${sub}@test`, groups: [TEST_GROUPS.users] })
    .returning({ id: users.id, sub: users.sub });
  if (!user) throw new Error('no user');
  const { token } = await createSession(db, user.id, { now, ttlHours: 1 });
  return { ...user, cookies: { outlet_session: token } };
}
