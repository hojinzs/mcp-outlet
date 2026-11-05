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

// 업스트림 토큰을 갱신하는 동안 같은 행을 갱신하려는 다른 요청·인스턴스를 기다리게 한다
export async function lockUserCredential(db: DbOrTx, connectorId: string, userId: string) {
  const [row] = await db
    .select({ id: credentials.id, ciphertext: credentials.ciphertext })
    .from(credentials)
    .where(and(eq(credentials.connectorId, connectorId), eq(credentials.userId, userId)))
    .for('update');
  return row;
}

export async function upsertUserCredential(
  db: DbOrTx,
  values: { connectorId: string; userId: string; ciphertext: string; account: string | null },
): Promise<void> {
  await db
    .insert(credentials)
    .values({ ...values, scope: 'user' })
    .onConflictDoUpdate({
      target: [credentials.connectorId, credentials.userId],
      set: { ciphertext: values.ciphertext, account: values.account },
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

// 키 회전 일괄 재암호화 대상을 고르려고 모든 행의 암호문을 읽는다 (scope 무관)
export async function listCredentialCiphertexts(db: DbOrTx) {
  return db.select({ id: credentials.id, ciphertext: credentials.ciphertext }).from(credentials);
}

// 재암호화하는 동안 토큰 갱신이 같은 행을 바꾸지 못하게 잠근다
export async function lockCredential(db: DbOrTx, id: string) {
  const [row] = await db
    .select({ id: credentials.id, ciphertext: credentials.ciphertext })
    .from(credentials)
    .where(eq(credentials.id, id))
    .for('update');
  return row;
}

// 키 회전 뒤 이전 키로 남은 암호문을 현재 키로 바꿔 쓴다. updatedAt(자격증명 변경 시각)은 그대로 둔다
export async function replaceCiphertext(db: DbOrTx, id: string, ciphertext: string): Promise<void> {
  await db
    .update(credentials)
    .set({ ciphertext, updatedAt: credentials.updatedAt })
    .where(eq(credentials.id, id));
}
