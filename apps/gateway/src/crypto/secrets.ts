import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// 자격증명 암호화 (비밀 보호: AES-256-GCM, 이전 키 병행으로 무중단 회전).
// 암호문: v1.{키 ID}.{iv}.{tag}.{본문} (모두 base64url). 키 ID는 키 SHA-256(base64url)의 앞 11자라
// 복호화할 키를 바로 고르고, 회전 뒤 아직 이전 키로 남은 행을 찾을 수 있다

const VERSION = 'v1';
const IV_BYTES = 12;
// 짧은 태그를 받으면 위조 난도가 내려간다. 암호화 때 만드는 길이(16바이트)만 받는다
const TAG_BYTES = 16;

type Key = { id: string; bytes: Buffer };

function toKey(base64: string): Key {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length !== 32) throw new Error('encryption key must be 32 bytes');
  return { id: createHash('sha256').update(bytes).digest('base64url').slice(0, 11), bytes };
}

export class SecretDecryptError extends Error {
  constructor() {
    super('secret decrypt failed');
    this.name = 'SecretDecryptError';
  }
}

export function createSecretBox(keys: { current: string; previous?: string | undefined }) {
  const current = toKey(keys.current);
  const byId = new Map([[current.id, current]]);
  if (keys.previous) {
    const previous = toKey(keys.previous);
    byId.set(previous.id, previous);
  }

  function encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', current.bytes, iv);
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const parts = [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url'));
    return [VERSION, current.id, ...parts].join('.');
  }

  // 원인 예외에는 키·본문 조각이 섞일 수 있어 종류 하나로만 던진다
  function decrypt(ciphertext: string): string {
    const [version, keyId, iv, tag, body, ...rest] = ciphertext.split('.');
    const key = keyId ? byId.get(keyId) : undefined;
    if (version !== VERSION || !key || !iv || !tag || body === undefined || rest.length > 0) {
      throw new SecretDecryptError();
    }
    const authTag = Buffer.from(tag, 'base64url');
    if (authTag.length !== TAG_BYTES) throw new SecretDecryptError();
    try {
      const decipher = createDecipheriv('aes-256-gcm', key.bytes, Buffer.from(iv, 'base64url'), {
        authTagLength: TAG_BYTES,
      });
      decipher.setAuthTag(authTag);
      const plain = Buffer.concat([
        decipher.update(Buffer.from(body, 'base64url')),
        decipher.final(),
      ]);
      return plain.toString('utf8');
    } catch {
      throw new SecretDecryptError();
    }
  }

  // 현재 키가 아닌 키로 만든 암호문인지. 회전 뒤 재암호화 대상을 고를 때 쓴다
  function needsRotation(ciphertext: string): boolean {
    return ciphertext.split('.')[1] !== current.id;
  }

  return { encrypt, decrypt, needsRotation };
}

export type SecretBox = ReturnType<typeof createSecretBox>;
