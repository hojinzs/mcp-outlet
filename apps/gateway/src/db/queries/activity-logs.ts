import type { DbOrTx } from '../client.ts';
import { activityLogs } from '../schema.ts';

// 사람이 한 작업 하나. 비밀값은 받지도 않는다
export async function insertActivityLog(
  db: DbOrTx,
  entry: Omit<typeof activityLogs.$inferInsert, 'id' | 'at'>,
): Promise<void> {
  await db.insert(activityLogs).values(entry);
}
