# `src/agent.ts`

## 职责

Agent 是 Loop 外层的生命周期驱动器，管理 inbox、turn、取消、状态订阅与恢复钩子。

## 主流程

`followup()` 写入下个 turn 的消息并唤醒运行；`inject()` 写入下个 step 的消息但不主动唤醒；`run()` 串行领取输入并调用 Agent Loop；`cancel()` 中止当前 turn；`whenIdle()` 等待完全收口。

## 不变量

- 同一 turn 共享一个稳定 `AbortSignal`。
- inbox 的插入和领取都是持久事件。
- 异常先闭合活动 step，再闭合 turn。
- `status` 是实时观察值，不是持久权威状态。

## 关联测试

`test/agent.test.ts`、`test/lifecycle.test.ts`。
