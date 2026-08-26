# `src/errors.ts`

## 职责

定义跨模型、Loop、工具和 Agent 使用的稳定失败码，并把任意异常规范化。

## 核心 API

`HarnessError` 携带 `FailureCode`；`normalizeFailure()` 识别取消、超时、限流、上下文和未知异常；`throwIfAborted()` 在异步边界统一抛出取消错误。

## 设计取舍

日志和 UI 依赖稳定 code，而不是 Provider 的原始错误文本。原始异常保留为 cause 供调试，但不会破坏对外失败分类。

## 关联测试

错误分类覆盖在 `test/agent.test.ts`、`test/llm.test.ts` 和工具相关测试中。
