# `src/sandbox-service.ts`

## 职责

定义进程沙箱 contract，并实现 macOS Seatbelt argv 包装。

## 模式

- `read-only`：允许读取，拒绝工作区写入。
- `workspace-write`：只允许指定工作区写入。
- `danger-full-access`：由上层明确选择不约束。

## Seatbelt

`probeSeatbelt()` 检查后端；`seatbeltProfile()` 生成最小 profile；`LocalSandboxProvider.confine()` 返回包装后的 argv 和 enforcement 信息，不直接启动进程。

工具策略检查调用意图，Seatbelt 约束实际进程副作用，两层都需要。

## 关联测试

`test/sandbox.test.ts`。
