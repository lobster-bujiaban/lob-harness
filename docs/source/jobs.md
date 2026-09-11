# `src/jobs.ts`

## 职责

定义后台 job 的工具层协议：启动、查询输出和取消。

## 工具行为

- `job` 接收 prompt，调用 runtime.start 后立即返回 jobId。
- `job_output` 非阻塞读取当前状态和输出。
- `job_kill` 请求取消，区分“已请求”和“早已结束”。

启动与取消是 exclusive，输出查询是 parallel。参数错误被转换为稳定 ToolError，不泄漏 Service 内部结构。

## 关联测试

`test/jobs.test.ts`。
