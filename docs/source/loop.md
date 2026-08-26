# `src/loop.ts`

## 职责

实现一个 turn 内的多步模型—工具循环，是 Harness 的核心编排器。

## 主流程

每个 step 从 Session 投影 messages，组装 system prompt 和工具 schema，拟合上下文预算，然后请求 LLM。文本回复写 assistant 并结束；工具回复先写 calls、执行批次、按序写 results，再进入下一 step。

## 扩展边界

- `preStep` 可允许、改写或拒绝输入。
- `requestError` 决定是否开始下一次 attempt。
- 工具策略、并发和超时由 ToolRegistry 负责。
- 压缩通过 session 事件实现，Loop 不改写历史。

达到 `maxSteps`、上下文无法压缩、模型失败或取消时，都写明确终态。

## 关联测试

`test/loop.test.ts`、`test/steps.test.ts`、`test/replay.test.ts`。
