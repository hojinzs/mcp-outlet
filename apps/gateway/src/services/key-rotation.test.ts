import { randomBytes, randomUUID } from 'node:crypto';
import { connectorManifestSchema } from '@mcp-outlet/shared';
import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createSecretBox } from '../crypto/secrets.ts';
import { insertConnector } from '../db/queries/connectors.ts';
import { replaceCiphertext } from '../db/queries/credentials.ts';
import { credentials, users } from '../db/schema.ts';
import { testDatabaseUrl, useTestDb } from '../testing/db.ts';
import { reencryptCredentials } from './key-rotation.ts';

// 다른 테스트 파일의 자격증명은 이 키들로 풀리지 않으므로 건드리지 않는다
const newKey = () => randomBytes(32).toString('base64');

describe.skipIf(!testDatabaseUrl)('키 회전 일괄 재암호화 (DB)', () => {
  const db = useTestDb();

  async function newCredential(ciphertext: string) {
    const [user] = await db
      .insert(users)
      .values({ sub: `rotation-${randomUUID()}`, groups: [] })
      .returning({ id: users.id });
    if (!user) throw new Error('no user');
    const manifest = connectorManifestSchema.parse({
      manifestVersion: 1,
      name: 'CMS',
      runtime: 'remote',
      url: 'https://mcp.example.com/mcp',
      auth: { type: 'none' },
    });
    const connector = await insertConnector(db, {
      ownerId: user.id,
      runtime: 'remote',
      manifest,
      status: 'ok',
    });
    const [row] = await db
      .insert(credentials)
      .values({ connectorId: connector.id, scope: 'user', userId: user.id, ciphertext })
      .returning({ id: credentials.id, updatedAt: credentials.updatedAt });
    if (!row) throw new Error('no credential');
    return row;
  }

  it('이전 키로 된 자격증명을 현재 키로 바꾸고, 현재 키로 된 것과 변경 시각은 그대로 둔다', async () => {
    const [oldKey, currentKey] = [newKey(), newKey()];
    const before = createSecretBox({ current: oldKey });
    const rotating = createSecretBox({ current: currentKey, previous: oldKey });
    const stale = await newCredential(before.encrypt('{"TOKEN":"a"}'));
    const currentCiphertext = rotating.encrypt('{"TOKEN":"b"}');
    const fresh = await newCredential(currentCiphertext);

    const result = await reencryptCredentials({ db, secrets: rotating });
    expect(result.rotated).toBeGreaterThanOrEqual(1);

    const rows = await db
      .select()
      .from(credentials)
      .where(inArray(credentials.id, [stale.id, fresh.id]));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const afterOnly = createSecretBox({ current: currentKey });
    expect(afterOnly.decrypt(byId.get(stale.id)?.ciphertext ?? '')).toBe('{"TOKEN":"a"}');
    expect(byId.get(stale.id)?.updatedAt).toEqual(stale.updatedAt);
    expect(byId.get(fresh.id)?.ciphertext).toBe(currentCiphertext);
  });

  it('읽은 뒤 다른 요청이 바꾼 암호문은 옛 값으로 덮어쓰지 않는다', async () => {
    const box = createSecretBox({ current: newKey() });
    const read = box.encrypt('{"TOKEN":"old"}');
    const row = await newCredential(read);
    const refreshed = box.encrypt('{"TOKEN":"refreshed"}');
    await db.update(credentials).set({ ciphertext: refreshed }).where(eq(credentials.id, row.id));

    const stale = box.encrypt('{"TOKEN":"old"}');
    expect(await replaceCiphertext(db, row.id, { from: read, to: stale })).toBe(false);
    const [after] = await db.select().from(credentials).where(eq(credentials.id, row.id));
    expect(after?.ciphertext).toBe(refreshed);
  });

  it('어느 키로도 풀리지 않는 자격증명은 남겨 두고 실패로 센다', async () => {
    const lost = createSecretBox({ current: newKey() }).encrypt('{"TOKEN":"c"}');
    const row = await newCredential(lost);
    const result = await reencryptCredentials({
      db,
      secrets: createSecretBox({ current: newKey() }),
    });
    expect(result.failed).toBeGreaterThanOrEqual(1);
    const [after] = await db.select().from(credentials).where(eq(credentials.id, row.id));
    expect(after?.ciphertext).toBe(lost);
  });
});
