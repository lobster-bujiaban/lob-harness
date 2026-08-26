# `src/retry.ts`

## 职责

创建 Agent 的默认模型请求恢复策略，集中管理可重试错误、次数、退避和 jitter。

## 策略

默认只重试 `EMPTY_RESPONSE`、`RATE_LIMITED` 和 `TIMEOUT`。首次请求后最多再尝试 5 次，延迟从 500ms 指数增长到 10s，并加入 10% 对称随机抖动。

## 关键点

- 时钟和随机数可注入，测试无需真实等待。
- 等待过程监听 AbortSignal，用户取消立即结束。
- 策略只回答 retry 与否，不执行模型请求。

## 关联测试

`test/agent.test.ts` 中的恢复、退避和取消用例。
