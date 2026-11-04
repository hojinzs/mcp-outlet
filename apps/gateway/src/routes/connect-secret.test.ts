import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { activityLogs } from '../db/schema.ts';
import { createLoggedInUser, testConfig } from '../testing/app.ts';
import { testDatabaseUrl, useTestDb } from '../testing/db.ts';
import { FAKE_CLIENT_SECRET } from '../testing/fake-idp.ts';

describe.skipIf(!testDatabaseUrl)('Client Secret 보기 API (DB)', () => {
  const db = useTestDb();

  const viewsOf = (actorId: string) =>
    db.select().from(activityLogs).where(eq(activityLogs.actorId, actorId));

  it('세션이 없으면 401', async () => {
    const app = await buildApp(testConfig(), db);
    expect((await app.inject('/api/connect-secret')).statusCode).toBe(401);
  });

  it('볼 때마다 작업 기록을 남기고, 기록에는 값을 담지 않는다', async () => {
    const app = await buildApp(testConfig(), db);
    const user = await createLoggedInUser(db);
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({ url: '/api/connect-secret', cookies: user.cookies });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ clientSecret: FAKE_CLIENT_SECRET });
      expect(res.headers['cache-control']).toBe('no-store');
    }
    const views = await viewsOf(user.id);
    expect(views).toHaveLength(2);
    expect(views[0]).toMatchObject({
      action: 'client_secret.view',
      targetType: 'oauth_client',
      targetId: null,
      reason: null,
    });
    expect(JSON.stringify(views)).not.toContain(FAKE_CLIENT_SECRET);
  });

  it('Public client 설치면 404이고 기록하지 않는다', async () => {
    const app = await buildApp(testConfig({ OIDC_CLIENT_SECRET: '' }), db);
    const user = await createLoggedInUser(db);
    const res = await app.inject({ url: '/api/connect-secret', cookies: user.cookies });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    expect(await viewsOf(user.id)).toHaveLength(0);
  });
});
