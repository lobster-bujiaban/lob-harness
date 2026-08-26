# `src/fs-service.ts`

## 职责

定义文本文件系统 Provider seam，并提供本地磁盘实现。

## LocalFsProvider

提供 realpath、stat、readText、list 和 writeText。读取使用严格 UTF-8；写入先创建同目录临时文件，再 rename 到目标路径，并在失败时清理临时文件。

## 边界

Provider 只实现 I/O 原语，不决定某个路径是否被当前会话授权。根目录、符号链接和大小策略在 `files.ts` 的 preExecute 层完成。

## 关联测试

`test/files.test.ts`、`test/composition.test.ts`。
