import { z } from 'zod';
import type { SecretBox } from '../crypto/secrets.ts';
import type { DbOrTx } from '../db/client.ts';
import {
  deleteUserCredential,
  findUserCredential,
  replaceCiphertext,
  upsertUserCredential,
} from '../db/queries/credentials.ts';

// 자격증명 필드 값을 JSON 하나로 묶어 암호화한다. 값은 API로 다시 내려주지 않는다

export type CredentialValues = Record<string, string>;

const valuesSchema = z.record(z.string(), z.string());

export async function loadCredentials(
  deps: { db: DbOrTx; secrets: SecretBox },
  connectorId: string,
  userId: string,
): Promise<CredentialValues> {
  const row = await findUserCredential(deps.db, connectorId, userId);
  if (!row) return {};
  const plain = deps.secrets.decrypt(row.ciphertext);
  // ENCRYPTION_KEY_PREVIOUS로 푼 값은 읽은 김에 현재 키로 다시 저장한다 (무중단 회전)
  if (deps.secrets.needsRotation(row.ciphertext)) {
    await replaceCiphertext(deps.db, row.id, deps.secrets.encrypt(plain));
  }
  return valuesSchema.parse(JSON.parse(plain));
}

// 값이 없으면(인증 없음) 자격증명 행을 지운다
export async function saveCredentials(
  deps: { db: DbOrTx; secrets: SecretBox },
  target: { connectorId: string; userId: string },
  values: CredentialValues,
): Promise<void> {
  if (Object.keys(values).length === 0) {
    await deleteUserCredential(deps.db, target.connectorId, target.userId);
    return;
  }
  const ciphertext = deps.secrets.encrypt(JSON.stringify(values));
  await upsertUserCredential(deps.db, { ...target, ciphertext });
}
