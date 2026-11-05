// SSE 응답의 이벤트마다 data(JSON-RPC 메시지)를 바꿔 쓰는 스트림 (F-RUN-01 SSE 무버퍼 전달).
// 이벤트 하나가 끝나는 즉시 내보내고 그 이상 모으지 않는다. JSON이 아닌 data는 손대지 않는다.
// rewrite가 undefined를 돌려주면 그 메시지는 클라이언트에 보내지 않는다.
// 끝나지 않은 이벤트가 상한을 넘으면 스트림을 오류로 끊는다(업스트림도 함께 끊긴다)

export class SseEventTooLarge extends Error {
  constructor() {
    super('sse event too large');
    this.name = 'SseEventTooLarge';
  }
}

function rewriteEvent(block: string, rewrite: (message: unknown) => unknown): string {
  const lines = block.split('\n');
  const dataLines = lines.filter((line) => line.startsWith('data:'));
  if (dataLines.length === 0) return `${block}\n\n`;
  const data = dataLines.map((line) => line.slice(5).replace(/^ /, '')).join('\n');
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return `${block}\n\n`;
  }
  const others = lines.filter((line) => !line.startsWith('data:'));
  const rewritten = rewrite(message);
  // 뺀 메시지는 data 없이 id 등만 남겨 재개 위치(Last-Event-ID)를 지킨다. data가 없는 이벤트는 전달되지 않는다
  if (rewritten === undefined) return others.length > 0 ? `${others.join('\n')}\n\n` : '';
  const head = others.length > 0 ? `${others.join('\n')}\n` : '';
  return `${head}data: ${JSON.stringify(rewritten)}\n\n`;
}

export function rewriteSse(
  rewrite: (message: unknown) => unknown,
  // 아직 끝나지 않은 이벤트로 모아 둔 문자 수의 상한
  maxEventLength: number,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';
  let normalized = '';

  // 줄바꿈을 \n으로 맞춘다. 청크 끝의 \r은 다음 청크의 \n과 짝일 수 있어 남겨 둔다
  function take(text: string): void {
    pending += text;
    const hold = pending.endsWith('\r') ? '\r' : '';
    normalized += pending.slice(0, pending.length - hold.length).replace(/\r\n?/g, '\n');
    pending = hold;
  }

  function drain(controller: TransformStreamDefaultController<Uint8Array>): void {
    for (let end = normalized.indexOf('\n\n'); end >= 0; end = normalized.indexOf('\n\n')) {
      const block = normalized.slice(0, end);
      normalized = normalized.slice(end + 2);
      const event = rewriteEvent(block, rewrite);
      if (event) controller.enqueue(encoder.encode(event));
    }
  }

  return new TransformStream({
    transform(chunk, controller) {
      take(decoder.decode(chunk, { stream: true }));
      drain(controller);
      if (normalized.length + pending.length > maxEventLength)
        controller.error(new SseEventTooLarge());
    },
    flush(controller) {
      take(decoder.decode());
      normalized += pending ? '\n' : '';
      pending = '';
      drain(controller);
      // 끝나지 않은 마지막 이벤트는 SSE 규칙상 버려지므로 원문 그대로 넘긴다
      if (normalized) controller.enqueue(encoder.encode(normalized));
    },
  });
}
