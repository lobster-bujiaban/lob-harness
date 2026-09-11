# `src/subprocess-service.ts`

## 职责

提供最底层 argv 子进程执行 seam；它不解释 shell 字符串，只执行已经组装好的 argv。

## LocalSubprocessProvider

使用 Node spawn，提供受限父进程环境、stdout/stderr 字节上限、超时和 AbortSignal 协作取消。结束后返回 exit code、signal、输出和 timeout 标记。

## 关键点

- `scrubbedParentEnv()` 只保留必要环境，避免凭据无意传入子进程。
- 输出有界，防止内存无限增长。
- shell 语义属于上层 `shell-service.ts`。

## 关联测试

`test/shell.test.ts`。
