# `src/tools.ts`

## 职责

实现工具注册表、pre/execute/post waterfall、审批、超时和批量调度。

## ToolRegistry

工具定义包含 schema、executor、`parallel/exclusive` mode 和可选 timeout。`register()` 返回 disposer；`run()` 统一规范化未知工具、策略拒绝、异常和后置阻断。

## 调度

`executeToolBatch()` 将连续 parallel 调用按并发上限执行，exclusive 调用前后形成 barrier。执行可乱序结束，但返回数组保持模型调用顺序。

## 审批

pre 阶段可返回 `ask`。只有 `allowed-once` 继续执行，询问与决定通过 audit sink 持久化；缺失 Provider 或非法结果失败关闭。

## 关联测试

`test/tools.test.ts`、`test/tool-scheduler.test.ts`、`test/approval.test.ts`。
