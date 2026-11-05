// 업스트림 MCP 메시지 하나의 크기 상한. 사용자가 등록한 원격 서버가 끝없는 본문으로
// gateway 메모리를 채우지 못하게 한다. 툴 목록·결과가 이보다 클 일은 드물다
export const MAX_UPSTREAM_MESSAGE_BYTES = 8 * 1024 * 1024;

// aborted: 본문을 끝까지 받지 못했다(업스트림이 끊었거나 요청이 취소됐다)
export type BoundedText = { text: string } | { rejected: 'too_large' | 'timeout' | 'aborted' };

// 크기와 시간 상한 안에서만 읽는다. 넘으면 업스트림 본문을 끊는다.
// 천천히 흘려보내는 JSON 본문이 연결을 붙잡지 못하게 한다. SSE는 장시간 연결이라 쓰지 않는다
export async function readBoundedText(
  body: ReadableStream<Uint8Array>,
  limits: { maxBytes: number; timeoutMs: number },
): Promise<BoundedText> {
  const reader = body.getReader();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    reader.cancel().catch(() => {});
  }, limits.timeoutMs);
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch {
        // 원문 예외는 부른 쪽에 넘기지 않는다. 분류값으로만 알린다
        return { rejected: timedOut ? 'timeout' : 'aborted' };
      }
      const { done, value } = chunk;
      if (timedOut) return { rejected: 'timeout' };
      if (done) break;
      size += value.byteLength;
      if (size > limits.maxBytes) {
        await reader.cancel();
        return { rejected: 'too_large' };
      }
      chunks.push(value);
    }
    return { text: Buffer.concat(chunks).toString('utf8') };
  } finally {
    clearTimeout(timer);
  }
}

// 툴 이름 길이 상한. 허용목록 입력과 감사 로그에 남기는 클라이언트 툴 이름이 같은 상한을 쓴다 (F-UI-03)
export const MAX_TOOL_NAME_LENGTH = 200;
