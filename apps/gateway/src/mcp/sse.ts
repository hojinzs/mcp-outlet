// SSE 응답의 이벤트마다 data(JSON-RPC 메시지)를 바꿔 쓰는 스트림 (F-RUN-01 SSE 무버퍼 전달).
// 이벤트 하나가 끝나는 즉시 내보내고 그 이상 모으지 않는다. JSON이 아닌 data는 손대지 않는다

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
  const head = others.length > 0 ? `${others.join('\n')}\n` : '';
  return `${head}data: ${JSON.stringify(rewrite(message))}\n\n`;
}

export function rewriteSse(
  rewrite: (message: unknown) => unknown,
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
      controller.enqueue(encoder.encode(rewriteEvent(block, rewrite)));
    }
  }

  return new TransformStream({
    transform(chunk, controller) {
      take(decoder.decode(chunk, { stream: true }));
      drain(controller);
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
