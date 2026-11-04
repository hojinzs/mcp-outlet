import { createDb, runMigrations } from '../db/client.ts';

// 테스트 파일들이 동시에 마이그레이션하지 않도록 한 번만 적용한다
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const { db, close } = createDb(url);
  try {
    await runMigrations(db);
  } finally {
    await close();
  }
}
