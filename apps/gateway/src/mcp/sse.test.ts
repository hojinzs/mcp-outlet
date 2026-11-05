import { describe, expect, it } from 'vitest';
import { rewriteSse, SseEventTooLarge } from './sse.ts';

async function run(chunks: string[], rewrite: (message: unknown) => unknown = (m) => m) {
  const encoder = new TextEncoder();
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  const outputs: string[] = [];
  const decoder = new TextDecoder();
  for await (const chunk of source.pipeThrough(rewriteSse(rewrite, 1024))) {
    outputs.push(decoder.decode(chunk));
  }
  return outputs;
}

describe('rewriteSse', () => {
  it('이벤트마다 data JSON을 바꾸고 id·event 필드를 남긴다', async () => {
    const out = await run(['event: message\nid: 1\ndata: {"a":1}\n\n'], (message) => ({
      ...(message as object),
      b: 2,
    }));
    expect(out).toEqual(['event: message\nid: 1\ndata: {"a":1,"b":2}\n\n']);
  });

  it('청크 경계에서 끊긴 이벤트와 CRLF를 이어 붙인다', async () => {
    const out = await run(['data: {"a"', ':1}\r', '\n\r\ndata: {"b":2}\n', '\n']);
    expect(out).toEqual(['data: {"a":1}\n\n', 'data: {"b":2}\n\n']);
  });

  it('여러 줄 data를 하나의 JSON으로 읽는다', async () => {
    const out = await run(['data: {"a":\ndata: 1}\n\n']);
    expect(out).toEqual(['data: {"a":1}\n\n']);
  });

  it('JSON이 아닌 data와 주석·빈 이벤트는 그대로 둔다', async () => {
    const out = await run([': ping\n\n', 'data: hello\n\n', 'retry: 1000\n\n']);
    expect(out).toEqual([': ping\n\n', 'data: hello\n\n', 'retry: 1000\n\n']);
  });

  it('rewrite가 undefined면 data를 빼고 id만 남기며, id도 없으면 이벤트를 내보내지 않는다', async () => {
    const drop = (message: unknown) => ((message as { drop?: boolean }).drop ? undefined : message);
    const out = await run(
      [
        'event: message\nid: 7\ndata: {"drop":true}\n\n',
        'data: {"drop":true}\n\n',
        'data: {"n":1}\n\n',
      ],
      drop,
    );
    expect(out).toEqual(['event: message\nid: 7\n\n', 'data: {"n":1}\n\n']);
  });

  it('이벤트가 끝나는 즉시 내보낸다', async () => {
    const encoder = new TextEncoder();
    let push: (text: string) => void = () => {};
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (text) => controller.enqueue(encoder.encode(text));
      },
    });
    const reader = source.pipeThrough(rewriteSse((m) => m, 1024)).getReader();
    push('data: {"n":1}\n\n');
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('data: {"n":1}\n\n');
    await reader.cancel();
  });

  it('끝나지 않은 이벤트가 상한을 넘으면 스트림을 오류로 끊는다', async () => {
    const huge = `data: ${'x'.repeat(2000)}`;
    await expect(run(['data: {"a":1}\n\n', huge])).rejects.toBeInstanceOf(SseEventTooLarge);
  });
});
