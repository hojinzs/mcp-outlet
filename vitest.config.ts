import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

// DB 테스트는 .env.test.local의 TEST_DATABASE_URL(compose Postgres의 outlet_test)을 쓴다.
// 없으면 DB 테스트를 건너뛴다. globalSetup과 워커가 함께 보도록 process.env에 둔다
if (!process.env.TEST_DATABASE_URL && existsSync('.env.test.local')) {
  const url = parseEnv(readFileSync('.env.test.local', 'utf8')).TEST_DATABASE_URL;
  if (url) process.env.TEST_DATABASE_URL = url;
}

export default defineConfig({
  test: {
    include: ['{apps,packages}/*/src/**/*.test.ts'],
    globalSetup: ['apps/gateway/src/testing/global-setup.ts'],
  },
});
