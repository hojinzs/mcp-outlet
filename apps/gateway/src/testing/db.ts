import { afterAll } from 'vitest';
import { createDb } from '../db/client.ts';

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// describe.skipIf(!testDatabaseUrl) 안에서 부른다. 파일이 끝나면 연결을 닫는다
export function useTestDb() {
  const { db, close } = createDb(testDatabaseUrl ?? '');
  afterAll(close);
  return db;
}
