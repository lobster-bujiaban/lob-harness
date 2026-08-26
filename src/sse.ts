export const SSE_DONE = "[DONE]";

/**
 * 按 SSE 事件边界解析 data 字段。只有收到 [DONE] 才算一次可信的完整响应；
 * EOF 前未结束的事件或缺少 [DONE] 都按断流处理。
 */
export async function* parseSse(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let first = true;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (first) {
        buffer = buffer.replace(/^\uFEFF/u, "");
        first = false;
      }
      buffer = buffer.replace(/\r\n|\r/gu, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = event
          .split("\n")
          .filter((line) => line === "data" || line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /u, ""))
          .join("\n");
        if (data.length > 0) {
          yield data;
          if (data === SSE_DONE) return;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error("SSE stream ended without [DONE]");
}
