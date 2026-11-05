import { type SecretBox, SecretDecryptError } from '../crypto/secrets.ts';
import type { Db } from '../db/client.ts';
import { listCredentialCiphertexts, replaceCiphertext } from '../db/queries/credentials.ts';

// 암호화 키 회전 마무리 (비밀 보호): ENCRYPTION_KEY_PREVIOUS로 된 자격증명을 기동 시 현재 키로 모두 바꾼다.
// 읽을 때 바꾸는 loadCredentials와 같은 일을 한 번에 해서, 이전 키를 언제 빼도 되는지 로그로 알 수 있게 한다

export type ReencryptResult = { rotated: number; failed: number };

export async function reencryptCredentials(deps: {
  db: Db;
  secrets: SecretBox;
}): Promise<ReencryptResult> {
  const rows = await listCredentialCiphertexts(deps.db);
  const result: ReencryptResult = { rotated: 0, failed: 0 };
  for (const { id, ciphertext } of rows) {
    if (!deps.secrets.needsRotation(ciphertext)) continue;
    const plaintext = tryDecrypt(deps.secrets, ciphertext);
    // 어느 키로도 풀리지 않는 행(이전 키를 이미 뺀 경우 등)은 남겨 두고 건수만 센다
    if (plaintext === null) {
      result.failed += 1;
      continue;
    }
    // 목록을 읽은 뒤 다른 요청이 이미 바꿨으면 그 값을 두고 건너뛴다
    const to = deps.secrets.encrypt(plaintext);
    if (await replaceCiphertext(deps.db, id, { from: ciphertext, to })) result.rotated += 1;
  }
  return result;
}

function tryDecrypt(secrets: SecretBox, ciphertext: string): string | null {
  try {
    return secrets.decrypt(ciphertext);
  } catch (error) {
    if (error instanceof SecretDecryptError) return null;
    throw error;
  }
}
