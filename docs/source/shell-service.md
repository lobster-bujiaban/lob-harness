# `src/shell-service.ts`

## 职责

把 shell 字符串执行建模为可替换 Provider，并提供本地与沙箱两种实现。

## Provider

`LocalBashProvider` 将 command 变成 `bash -c` 后交给 subprocess。`SandboxBashProvider` 先根据 mode/workspaceRoot 调用 sandbox.confine，再执行包装后的 argv。

## 失败原则

要求沙箱时若后端不可用，返回 `SANDBOX_UNAVAILABLE`，不会静默退回裸 bash。`danger-full-access` 则明确绕过约束，而不是伪装成已沙箱化。

## 关联测试

`test/shell.test.ts`、`test/sandbox.test.ts`。
