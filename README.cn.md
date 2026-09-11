[English](README.md) | 中文

# LOB Harness

**状态：研究** — 可运行的 Agent Loop，不是生产级编码 Agent。

按 DeepSeek Harness 的形态做的 TypeScript 实现：Cordis 装配、JSONL 会话、工具注册表、Web UI。装配在 `src/composition.ts`，HTTP/SSE 在 `src/web.ts`。

## What

Turn / Step 循环：JSONL 回放、OpenAI 兼容流式、工作区工具、macOS Seatbelt、进程内 MCP 演示、子 Agent、job、goal。

## Run in 3 commands

需要 Node.js `^22.19.0` 或 `>=24.0.0`（见 `package.json` `engines`）。

```bash
npm install
npm run web
open http://127.0.0.1:8787
```

`npm run web` 即 `tsx watch src/web.ts`。端口是 `process.env.PORT ?? 8787`。在界面新建会话，于模型设置里填 OpenAI 兼容 Key（`src/llm-settings.ts`）。密钥在 gitignore 的 `tmp/config/`。

```bash
npm test
npm run typecheck
```

## Architecture

由 `src/composition.ts` 的 `assembleWebContext` 串起来：

```text
web.ts (HTTP / SSE)
  → AgentService / AgentLoopService
  → runTurn (src/loop.ts): turn → step → LLM stream → tools
  → SessionStore + JsonlSessionPersistence
  → ToolsService / ToolRegistry (preExecute → execute → postExecute)
  → fs / shell+sandbox / MCP / subagent / jobs / goals
  → append SessionEvent
```

默认 `maxSteps`：`100`。默认并行工具数：`4`（`src/loop.ts`）。

上下文压缩用约 4 字符/token 的计量，策略是工具结果裁剪 / 摘要（`src/context.ts`）。

## 工具（来自插件，不是 loop 里写死）

`src/plugins.ts` 注册 Cordis 内置插件。除注明外默认开启：

| Plugin id | 源码 | 工具 |
|---|---|---|
| `core-tools` | `src/tools.ts` | `echo` |
| `workspace-files` | `src/files.ts` | `read_file`, `list_files`, `write_file`, `edit`, `grep` |
| `workspace-shell` | `src/bash.ts` | `bash`（win32 为 `pwsh`） |
| `mcp-client` | `src/mcp.ts` | `mcp__demo__ping` — **默认关闭** |
| `subagent` | `src/subagent.ts` | `subagent` |
| `tool-jobs` | `src/jobs.ts` | `job`, `job_output`, `job_kill` |
| `tool-goal` | `src/goal.ts` | `get_goal`, `create_goal`, `complete_goal` |
| `hyperframes-video` | `src/hyperframes-video.ts` | `video_analyze_source`, `video_create_hyperframes`, `video_generate_voice`, `video_render_hyperframes` |
| `wechat-article` | `src/wechat-article.ts` | `wechat_create_article` |

MCP 是 `MemoryMcpSession`：进程内 handler，**没有 JSON-RPC / stdio / HTTP**。对外名是 `mcp__{server}__{raw}`（`src/mcp.ts`）。

## Sandbox

`LocalSandboxProvider`（`src/sandbox-service.ts`）用 macOS `sandbox-exec` 包一层 argv。模式：`read-only`、`workspace-write`、`danger-full-access`。Seatbelt 不可用时抛 `SANDBOX_UNAVAILABLE`，不会裸跑。本仓库没有 Linux bwrap / Win32 ACL 后端。

## 会话与配置

- 运行中会话：`tmp/` 下 JSONL（`src/session-persistence.ts`）
- 只读 fixture：`test/fixtures/`
- 按事件边界 fork：`src/session-store.ts` 的 `forkSession`
- 打印 Cordis 树：`node --import tsx src/web.ts --dump-config`
- 按 id 整段替换配置（不是深合并）：`--profile ./web.profile.json`

## 与代码一致的边界

- 子 Agent 同进程、独立 JSONL；不能嵌套 `subagent`、写文件、job、goal（`src/subagent.ts`）
- `write_file` 整文件覆盖；`edit` 是字面量替换（`src/files.ts`）
- 审批是注册表上的一次性 provider（`src/tools.ts`、`src/approval.ts`）

## 许可证

Apache License 2.0，见 [LICENSE](LICENSE)。

## 联系

[chishishuan@gmail.com](mailto:chishishuan@gmail.com) · [GitHub Issues](https://github.com/lobster-bujiaban/lob-harness/issues)
