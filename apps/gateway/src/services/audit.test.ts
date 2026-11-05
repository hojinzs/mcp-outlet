import { randomUUID } from 'node:crypto';
import { connectorManifestSchema } from '@mcp-outlet/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { insertConnector } from '../db/queries/connectors.ts';
import { insertEndpoint } from '../db/queries/endpoints.ts';
import { auditLogs, endpoints, users } from '../db/schema.ts';
import { testDatabaseUrl, useTestDb } from '../testing/db.ts';
import { AUDIT_PAGE_SIZE, listAudit, summarizeAudit } from './audit.ts';
import { ServiceError } from './errors.ts';

describe.skipIf(!testDatabaseUrl)('감사 로그 조회·요약 (DB)', () => {
  const db = useTestDb();

  // 사용자 하나와 커넥터·엔드포인트 하나. 사용자마다 따로 만들어 다른 테스트 기록과 섞이지 않게 한다
  async function fixture() {
    const sub = `audit-${randomUUID()}`;
    const [user] = await db
      .insert(users)
      .values({ sub, email: `${sub}@test` })
      .returning({ id: users.id });
    if (!user) throw new Error('no user');
    const manifest = connectorManifestSchema.parse({
      manifestVersion: 1,
      name: 'CMS',
      runtime: 'remote',
      url: 'https://mcp.example.com/mcp',
      credentials: [],
      auth: { type: 'none' },
    });
    const connector = await insertConnector(db, {
      ownerId: user.id,
      runtime: 'remote',
      manifest,
      status: 'ok',
    });
    const endpoint = await insertEndpoint(db, {
      ownerId: user.id,
      connectorId: connector.id,
      name: 'Home',
    });
    const base = { userId: user.id, endpointId: endpoint.id, connectorId: connector.id };
    return { user, connector, endpoint, base };
  }

  it('필터를 걸고 최신순으로 50건씩, 같은 시각도 빠짐없이 커서로 넘긴다', async () => {
    const { user, base } = await fixture();
    const at = new Date('2026-11-05T01:00:00Z');
    // 같은 시각 기록 60건: 커서가 at만 보면 겹치거나 빠진다
    await db.insert(auditLogs).values(
      Array.from({ length: 60 }, (_, i) => ({
        ...base,
        at,
        toolName: `read_${i}`,
        result: 'ok' as const,
        durationMs: i,
      })),
    );
    const first = await listAudit({ db }, { userId: user.id }, undefined);
    expect(first.entries).toHaveLength(AUDIT_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
    const second = await listAudit({ db }, { userId: user.id }, first.nextCursor ?? undefined);
    expect(second.entries).toHaveLength(10);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.entries, ...second.entries].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(60);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(first.entries[0]).toMatchObject({
      user: { id: user.id },
      endpoint: { id: base.endpointId, name: 'Home' },
      connector: { id: base.connectorId, name: 'CMS' },
      result: 'ok',
    });
  });

  it('기간·결과·툴 이름·엔드포인트로 거르고, 지워진 엔드포인트는 null로 준다', async () => {
    const { user, endpoint, base } = await fixture();
    await db.insert(auditLogs).values([
      {
        ...base,
        at: new Date('2026-11-01T00:00:00Z'),
        toolName: 'old',
        result: 'ok',
        durationMs: 1,
      },
      {
        ...base,
        at: new Date('2026-11-05T00:00:00Z'),
        toolName: 'get_page',
        result: 'denied',
        durationMs: 0,
      },
      {
        ...base,
        at: new Date('2026-11-05T00:01:00Z'),
        toolName: 'get_item',
        result: 'error',
        durationMs: 5,
      },
      {
        ...base,
        at: new Date('2026-11-05T00:02:00Z'),
        toolName: 'get_100%',
        result: 'ok',
        durationMs: 7,
      },
    ]);
    const list = async (filter: Parameters<typeof listAudit>[1]) =>
      (await listAudit({ db }, { userId: user.id, ...filter }, undefined)).entries.map(
        (entry) => entry.toolName,
      );
    expect(await list({ from: new Date('2026-11-04T00:00:00Z') })).toEqual([
      'get_100%',
      'get_item',
      'get_page',
    ]);
    expect(await list({ to: new Date('2026-11-02T00:00:00Z') })).toEqual(['old']);
    expect(await list({ result: 'denied' })).toEqual(['get_page']);
    expect(await list({ tool: 'ITEM' })).toEqual(['get_item']);
    expect(await list({ tool: '100%' })).toEqual(['get_100%']);
    expect(await list({ endpointId: randomUUID() })).toEqual([]);

    await db.delete(endpoints).where(eq(endpoints.id, endpoint.id));
    const [latest] = (await listAudit({ db }, { userId: user.id }, undefined)).entries;
    expect(latest).toMatchObject({ endpoint: null, connector: { name: 'CMS' } });
  });

  it('요약은 호출·오류·거부 수와 소요시간 중앙값·p95를 준다', async () => {
    const { user, base } = await fixture();
    const results = ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'error', 'error', 'denied'] as const;
    await db
      .insert(auditLogs)
      .values(
        results.map((result, i) => ({ ...base, toolName: 't', result, durationMs: (i + 1) * 100 })),
      );
    expect(await summarizeAudit({ db, retentionDays: 90 }, { userId: user.id })).toEqual({
      total: 10,
      errors: 2,
      denied: 1,
      durationMs: { p50: 550, p95: 955 },
      retentionDays: 90,
    });
    expect(await summarizeAudit({ db, retentionDays: 0 }, { userId: randomUUID() })).toEqual({
      total: 0,
      errors: 0,
      denied: 0,
      durationMs: { p50: null, p95: null },
      retentionDays: 0,
    });
  });

  it('형식이 틀린 커서는 invalid_request', async () => {
    await expect(listAudit({ db }, {}, 'not-a-cursor')).rejects.toEqual(
      new ServiceError('invalid_request'),
    );
  });
});
