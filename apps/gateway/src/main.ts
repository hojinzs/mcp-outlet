import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createSecretBox } from './crypto/secrets.ts';
import { createDb, runMigrations } from './db/client.ts';
import { reencryptCredentials } from './services/key-rotation.ts';
import { scheduleRetention } from './services/retention.ts';

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);

await runMigrations(db);

const app = await buildApp(config, db);
await app.listen({ host: config.HOST, port: config.PORT });
const stopRetention = scheduleRetention(
  { db, now: () => new Date(), log: app.log },
  { audit: config.AUDIT_RETENTION_DAYS, activity: config.ACTIVITY_RETENTION_DAYS },
);

// 키 회전 중이면 이전 키로 남은 자격증명을 기동 시 한 번에 현재 키로 바꾼다. 건수만 남긴다
if (config.ENCRYPTION_KEY_PREVIOUS) {
  const secrets = createSecretBox({
    current: config.ENCRYPTION_KEY,
    previous: config.ENCRYPTION_KEY_PREVIOUS,
  });
  reencryptCredentials({ db, secrets }).then(
    (result) => app.log.info(result, 'credentials re-encrypted with current key'),
    (error: unknown) =>
      app.log.warn({ errName: (error as Error)?.name }, 'credential re-encryption failed'),
  );
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    stopRetention();
    await app.close();
    await close();
    process.exit(0);
  });
}
