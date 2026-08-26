# `src/jobs-service.ts`

## 职责

在子 Agent 基础设施上提供后台 job 的启动、快照、等待和取消。

## 主流程

`start()` 创建独立 job 会话和 Agent，登记 ownership 后立即返回 jobId；后台 Promise 更新 running/completed/failed/killed 状态。`output()` 非阻塞读取，`wait()` 等待终态，`kill()` 请求协作式取消。

## 关键点

- jobId 只能由创建它的 parent session 查询。
- 最终输出从 job 子会话的最后 assistant 投影。
- 父 turn 不等待 job 完成，也没有自动 wakeup。

## 关联测试

`test/jobs.test.ts`。
