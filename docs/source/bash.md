# `src/bash.ts`

## 职责

把模型的 command/workdir/timeout 参数转换为 `ctx.shell.run()` 请求，并渲染有界结果。

## 安全边界

preExecute 策略拒绝空命令、危险前缀和根目录外 workdir；工具本身不 spawn，也不负责操作系统沙箱。

## 输出

`renderShellResult()` 合并 stdout、stderr、退出码、超时和 sandbox 信息，使模型获得稳定文本结果。命令失败属于工具结果，不自动终止整个 turn。

## 关联测试

`test/shell.test.ts`、`test/sandbox.test.ts`。
