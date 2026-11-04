import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { testConfig } from './testing/app.ts';
import { testDatabaseUrl, useTestDb } from './testing/db.ts';

describe.skipIf(!testDatabaseUrl)('관리 UI 서빙 (WEB_DIST_DIR)', () => {
  const db = useTestDb();
  const dist = mkdtempSync(join(tmpdir(), 'outlet-web-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)');
  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  it('화면 경로는 새로고침해도 index.html, 없는 정적 파일과 다른 경로는 404', async () => {
    const app = await buildApp(testConfig({ WEB_DIST_DIR: dist }), db);
    for (const url of ['/admin', '/admin/', '/admin/endpoints/abc/connect', '/admin/login?x=1']) {
      const res = await app.inject(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toContain('id="root"');
    }
    expect((await app.inject('/admin/assets/app.js')).body).toContain('console.log');
    for (const url of ['/admin/assets/missing.js', '/adminx', '/api/nope']) {
      expect((await app.inject(url)).statusCode, url).toBe(404);
    }
    await app.close();
  });
});
