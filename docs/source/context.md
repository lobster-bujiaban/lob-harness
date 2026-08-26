# `src/context.ts`

## 职责

在模型请求前执行 token 估算、工具结果裁剪和历史摘要，确保输入落入上下文预算。

## 主流程

`fitContext()` 先计量原消息；超预算时调用 `pruneToolResults()` 保留长工具结果的头尾，再调用 `summarizeMessages()` 压缩早期历史并保留最近消息。

## 关键点

- `TokenMeter` 是 seam，默认 `CharacterTokenMeter` 使用确定性字符估算。
- 工具 call/result 边界不能被拆散。
- 压缩结果由调用方写成 `context_compacted` 事件。
- 如果压缩没有足够进展，抛出 `CONTEXT_WINDOW_EXCEEDED`，避免死循环。

## 关联测试

`test/loop.test.ts` 中的上下文预算与压缩用例。
