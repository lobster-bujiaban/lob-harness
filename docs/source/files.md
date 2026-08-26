# `src/files.ts`

## 职责

实现 `read_file`、`list_files`、`write_file` 和 `grep`，以及工作区根目录授权策略。

## 路径安全

先检查词法路径是否在 root 内，再检查 canonical realpath。已有文件校验自身，新文件校验最近存在祖先，避免符号链接和 `..` 越界。

## 工具行为

- 读取只接受普通文件和严格 UTF-8，并限制最大字节数。
- 列表递归但有条目上限；默认跳过 `node_modules`、`dist`、`target`、`build`、`coverage`；未过滤扩展名时先列出当前层子目录。
- 写入是整文件覆盖，通过 `ctx.fs.writeText()` 原子完成。
- `grep` 用正则搜文件内容，可用 `include` 限制文件名，跳过默认排除目录和非 UTF-8 文件。

文件工具不直接调用 Node 文件系统，真实 I/O 由 `fs-service.ts` Provider 承担。

## 关联测试

`test/files.test.ts`。
