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

describe('readBoundedText', () => {
  it('상한 안이면 본문 전체를 돌려준다', async () => {
    expect(await readBoundedText(streamOf(['{"a":', '1}']), 10)).toBe('{"a":1}');
  });

  it('상한을 넘으면 업스트림을 끊고 null', async () => {
    let cancelled = false;
    const body = streamOf(['12345', '67890', 'x'], () => {
      cancelled = true;
    });
    expect(await readBoundedText(body, 10)).toBeNull();
    expect(cancelled).toBe(true);
  });
});
