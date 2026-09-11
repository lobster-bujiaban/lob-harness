# `src/sse.ts`

## 职责

把 HTTP response body 的字节流解析为 SSE data 事件。

## 主流程

`parseSse()` 使用 TextDecoder 增量解码，处理跨 chunk 的行和 event 边界，只产出 `data:` 内容；`[DONE]` 由 `SSE_DONE` 常量统一表示。

## 设计取舍

解析器不知道 OpenAI 消息结构，只负责 SSE framing。模型字段解释留在 `llm.ts`，因此解析器可独立测试截断、空行和多行到达方式。

## 关联测试

`test/sse.test.ts`。
