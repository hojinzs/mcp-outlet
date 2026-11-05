import { describe, expect, it } from 'vitest';
import { createSecretBox, SecretDecryptError } from './secrets.ts';

const keyA = Buffer.alloc(32, 1).toString('base64');
const keyB = Buffer.alloc(32, 2).toString('base64');

describe('createSecretBox', () => {
  it('암호화한 값을 되돌리고, 같은 평문도 매번 다른 암호문을 만든다', () => {
    const box = createSecretBox({ current: keyA });
    const first = box.encrypt('{"TOKEN":"secret"}');
    expect(first).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(first).not.toContain('secret');
    expect(box.encrypt('{"TOKEN":"secret"}')).not.toBe(first);
    expect(box.decrypt(first)).toBe('{"TOKEN":"secret"}');
  });

  it('회전 중에는 이전 키로 만든 암호문도 풀고, 새 암호문은 현재 키로 만든다', () => {
    const before = createSecretBox({ current: keyA });
    const old = before.encrypt('old');
    const rotating = createSecretBox({ current: keyB, previous: keyA });
    expect(rotating.decrypt(old)).toBe('old');
    expect(rotating.needsRotation(old)).toBe(true);
    const fresh = rotating.encrypt('new');
    expect(rotating.needsRotation(fresh)).toBe(false);
    expect(createSecretBox({ current: keyB }).decrypt(fresh)).toBe('new');
  });

  it('이전 키를 빼면 그 키의 암호문은 풀지 못한다', () => {
    const old = createSecretBox({ current: keyA }).encrypt('old');
    expect(() => createSecretBox({ current: keyB }).decrypt(old)).toThrow(SecretDecryptError);
  });

  it('변조·형식 오류는 SecretDecryptError 하나로 거부한다', () => {
    const box = createSecretBox({ current: keyA });
    const [version, keyId, iv, tag, body] = box.encrypt('value').split('.');
    const flipped = `${body?.startsWith('A') ? 'B' : 'A'}${body?.slice(1)}`;
    for (const bad of [
      [version, keyId, iv, tag, flipped].join('.'),
      ['v2', keyId, iv, tag, body].join('.'),
      [version, keyId, iv, tag].join('.'),
      'plain-text',
    ]) {
      expect(() => box.decrypt(bad)).toThrow(SecretDecryptError);
    }
  });

  it('16바이트가 아닌 인증 태그는 거부한다', () => {
    const box = createSecretBox({ current: keyA });
    const [version, keyId, iv, tag, body] = box.encrypt('value').split('.');
    const short = Buffer.from(tag ?? '', 'base64url')
      .subarray(0, 4)
      .toString('base64url');
    expect(() => box.decrypt([version, keyId, iv, short, body].join('.'))).toThrow(
      SecretDecryptError,
    );
  });
});
