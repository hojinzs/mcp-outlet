import { describe, expect, it } from 'vitest';
import { readBoundedText } from './limits.ts';

function streamOf(parts: string[], onCancel?: () => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      const part = parts[i++];
      if (part === undefined) controller.close();
      else controller.enqueue(encoder.encode(part));
    },
    cancel: onCancel,
  });
}

const limits = { maxBytes: 10, timeoutMs: 1000 };

describe('readBoundedText', () => {
  it('상한 안이면 본문 전체를 돌려준다', async () => {
    expect(await readBoundedText(streamOf(['{"a":', '1}']), limits)).toEqual({ text: '{"a":1}' });
  });

  it('상한을 넘으면 업스트림을 끊고 too_large', async () => {
    let cancelled = false;
    const body = streamOf(['12345', '67890', 'x'], () => {
      cancelled = true;
    });
    expect(await readBoundedText(body, limits)).toEqual({ rejected: 'too_large' });
    expect(cancelled).toBe(true);
  });

  it('본문이 시간 안에 끝나지 않으면 업스트림을 끊고 timeout', async () => {
    let cancelled = false;
    // 첫 조각만 보내고 끝내지 않는 본문
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const result = await readBoundedText(body, { maxBytes: 10, timeoutMs: 50 });
    expect(result).toEqual({ rejected: 'timeout' });
    expect(cancelled).toBe(true);
  });

  it('본문을 읽다 업스트림이 끊기면 원문 예외 없이 aborted', async () => {
    // 첫 조각 뒤 연결이 끊긴 본문
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":'));
      },
      pull(controller) {
        controller.error(new Error('socket hang up: secret-token'));
      },
    });
    expect(await readBoundedText(body, limits)).toEqual({ rejected: 'aborted' });
  });
});
