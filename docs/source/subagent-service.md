# `src/subagent-service.ts`

## 职责

管理前台可继续子 Agent 的创建、归属校验、恢复和执行。

## 主流程

首次委派创建 child session，写 descriptor 与父级 started 事件；继续时校验 childId 属于当前父会话。子 Agent 使用独立 SessionStore 和受限工具表，运行到 idle 后提取最后 assistant 输出并写父级 ended 事件。

## 不变量

- 子会话是独立事实来源，不嵌进父级 messages。
- 父模型只通过 subagent 的 tool result 看到结果。
- workspace、source 和 parentSessionId 归属必须匹配。
- 取消信号传递给子 Agent。

## 关联测试

`test/subagent.test.ts`。
