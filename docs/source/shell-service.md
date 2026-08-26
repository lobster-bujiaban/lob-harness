# `src/shell-service.ts`

## 职责

把 shell 字符串执行建模为可替换 Provider，并提供 Bash、PowerShell 及其沙箱消费实现。

## Provider

`LocalBashProvider` 将 command 变成 `bash -c`。`LocalPowerShellProvider` 使用 `pwsh -NoLogo -NoProfile -NonInteractive -Command`，命令保持一个 argv 并注入 UTF-8 输出前导。两个 Sandbox Provider 都先根据 mode/workspaceRoot 调用 sandbox.confine，再执行包装后的 argv。

## 失败原则

要求沙箱时若后端不可用，返回 `SANDBOX_UNAVAILABLE`，不会静默退回裸执行。Windows 当前正是这一状态；`danger-full-access` 明确以 `enforcement: none` 绕过约束，而不是伪装成已沙箱化。

## 关联测试

`test/shell.test.ts`、`test/sandbox.test.ts`。
