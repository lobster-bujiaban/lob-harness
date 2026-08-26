# `src/goal.ts`

## 职责

定义会话 goal 的事件快照、运行时接口、模型工具和折叠函数。

## 核心行为

`deriveGoal()` 扫描事件并取最后一次 `goal_change`；`installGoal()` 注册 `get_goal`、`create_goal` 和 `complete_goal`。读取可 parallel，状态变更使用 exclusive。

## 设计取舍

工具只消费 `GoalRuntime`，不直接读写 Session。`renderGoal()` 统一返回 JSON 文本，让模型明确看到目标 id、revision、objective 和 phase。

## 关联测试

`test/goal.test.ts`。
