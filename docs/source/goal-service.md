# `src/goal-service.ts`

## 职责

实现当前会话单目标的读取、创建和完成，并把状态完全保存为事件。

## 主流程

`get()` 加载会话并用 `deriveGoal()` 折叠；`create()` 拒绝覆盖 active 目标，为新目标生成 id/revision；`complete()` 将当前 active 目标 revision 加一并标记 completed。每次变化追加完整 `goal_change` 快照。

## 不变量

- 不维护另一份运行时权威目标。
- 同一会话最多一个当前目标。
- goal 事件不进入模型消息投影。
- goal 不自动驱动 Agent 续跑。

## 关联测试

`test/goal.test.ts`。
