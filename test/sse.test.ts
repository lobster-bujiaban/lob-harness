import { expect, test } from "vitest";
import { parseSse } from "../src/sse.ts";

function byteStream(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

test("SSE 解析可跨字节块重组事件并保留 DONE", async () => {
  const values: string[] = [];
  for await (const value of parseSse(byteStream([
    "data: {\"choices\":",
    "[]}\r\n\r\ndata: [DO",
    "NE]\n\n",
  ]))) {
    values.push(value);
  }
  expect(values).toEqual(['{"choices":[]}', "[DONE]"]);
});

test("SSE 缺少 DONE 时按断流失败", async () => {
  const consume = async () => {
    for await (const _value of parseSse(byteStream(["data: {}\n\n"]))) {
      // consume
    }
  };
  await expect(consume()).rejects.toThrow("without [DONE]");
});

test("调用方可选择自行校验 EOF 完整性", async () => {
  const values: string[] = [];
  for await (const value of parseSse(byteStream(["data: {}\n\n"]), { allowEof: true })) {
    values.push(value);
  }
  expect(values).toEqual(["{}"]);
});
