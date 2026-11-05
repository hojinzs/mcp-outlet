// 업스트림 MCP 메시지 하나의 크기 상한. 사용자가 등록한 원격 서버가 끝없는 본문으로
// gateway 메모리를 채우지 못하게 한다. 툴 목록·결과가 이보다 클 일은 드물다
export const MAX_UPSTREAM_MESSAGE_BYTES = 8 * 1024 * 1024;

// 상한까지만 읽는다. 넘으면 업스트림 본문을 끊고 null
export async function readBoundedText(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<string | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
