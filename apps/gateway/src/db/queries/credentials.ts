import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { credentials } from '../schema.ts';

// v1 자격증명은 모두 사용자 본인 것이다(scope user). 값은 암호문으로만 다룬다

export async function findUserCredential(db: DbOrTx, connectorId: string, userId: string) {
  const [row] = await db
    .select({ id: credentials.id, ciphertext: credentials.ciphertext })
    .from(credentials)
    .where(and(eq(credentials.connectorId, connectorId), eq(credentials.userId, userId)));
  return row;
}

export async function upsertUserCredential(
  db: DbOrTx,
  values: { connectorId: string; userId: string; ciphertext: string },
): Promise<void> {
  await db
    .insert(credentials)
    .values({ ...values, scope: 'user' })
    .onConflictDoUpdate({
      target: [credentials.connectorId, credentials.userId],
      set: { ciphertext: values.ciphertext },
    });
}

export async function deleteUserCredential(
  db: DbOrTx,
  connectorId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(credentials)
    .where(and(eq(credentials.connectorId, connectorId), eq(credentials.userId, userId)));
}

// 키 회전 뒤 이전 키로 남은 암호문을 현재 키로 바꿔 쓴다. updatedAt(자격증명 변경 시각)은 그대로 둔다
export async function replaceCiphertext(db: DbOrTx, id: string, ciphertext: string): Promise<void> {
  await db
    .update(credentials)
    .set({ ciphertext, updatedAt: credentials.updatedAt })
    .where(eq(credentials.id, id));
}
