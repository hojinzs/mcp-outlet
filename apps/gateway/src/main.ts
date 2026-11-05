import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb, runMigrations } from './db/client.ts';
import { scheduleLogRetention } from './services/retention.ts';

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);

await runMigrations(db);

const app = await buildApp(config, db);
await app.listen({ host: config.HOST, port: config.PORT });
const stopRetention = scheduleLogRetention(
  { db, now: () => new Date(), log: app.log },
  { audit: config.AUDIT_RETENTION_DAYS, activity: config.ACTIVITY_RETENTION_DAYS },
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    stopRetention();
    await app.close();
    await close();
    process.exit(0);
  });
}
