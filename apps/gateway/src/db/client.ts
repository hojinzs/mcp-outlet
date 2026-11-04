import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema.ts';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export function createDb(url: string) {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema, casing: 'snake_case' });
  return { db, close: () => client.end() };
}

export type Db = ReturnType<typeof createDb>['db'];
// 쿼리 함수는 트랜잭션 안에서도 쓸 수 있게 둘 다 받는다
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder });
}
