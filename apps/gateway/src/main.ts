import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb, runMigrations } from './db/client.ts';

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);

await runMigrations(db);

const app = await buildApp(config, db);
await app.listen({ host: config.HOST, port: config.PORT });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await close();
    process.exit(0);
  });
}
