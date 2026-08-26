# LOB Harness

> 不只讲 Agent，直接把它跑起来。

LOB Harness 是「虾哥不加班」开源的 Agent 运行骨架。它把会话回放、流式模型、工具调用、沙箱、子 Agent 和后台任务做成一套可以直接运行、阅读和改造的完整工程。

它服务两类人：第一次系统理解 Agent 工作原理的开发者，以及需要从可运行代码中寻找工程实现参考的人。项目只提供 Web 入口，当前仍是教学与实验实现，不是生产级通用编码 Agent。

## 你能从这里获得什么

- 跑起来：从 Web 发出一条消息，观察模型、工具和多步循环完整工作。
- 看明白：通过事件流程理解 Agent 为什么能够回放、恢复、取消和继续。
- 改得动：模型、工具、持久化、文件系统和沙箱都有清晰的替换边界。
- 做完整：不止展示聊天 Demo，还包含工作区、审批、子 Agent、job 和 goal。

## 快速开始

要求 Node.js `^22.19.0` 或 `>=24.0.0`。

```bash
npm install
npm run web
```

浏览器打开 <http://127.0.0.1:8787>，新建会话后在右上角「模型设置」中填写 API Key。默认监听 `127.0.0.1:8787`，可通过 `PORT` 修改端口。

开发服务使用 `tsx watch`：服务端代码变更会重启，`web/` 资源变更会让浏览器刷新。

常用检查：

```bash
npm test
npm run typecheck
```

## 使用方式

### 模型设置

项目使用 OpenAI-compatible Chat Completions SSE 协议。API 地址、模型名称和 API Key 都在 Web 中管理，每轮请求前重新读取，因此保存后无需重启。

- 普通配置：`tmp/config/llm-settings.json`
- 凭据：`tmp/config/credentials.json`
- 设置 API 只返回 `hasApiKey`，不会回传明文密钥

`tmp/` 已忽略，不应把密钥写入代码、文档、会话或 fixture。

### 会话与工作区

临时会话以 JSONL 直接保存在 `tmp/`，测试 fixture 位于 `test/fixtures/`。fixture 在 Web 中只读；临时会话可新建、删除、清空和从事件边界 fork。

每个临时会话可以选择独立的工作区根目录。选择结果以 `workspace_root` 事件持久化，后续 turn 会按该目录重组工具；Agent 运行中不能切换工作区。macOS 可使用原生目录选择器。

### 配置树与 profile

查看实际装配的配置树：

```bash
node --import tsx src/web.ts --dump-config
```

用 profile 按条目 `id` 替换完整 `config`（不是深合并）：

```bash
node --import tsx src/web.ts --profile ./web.profile.json --dump-config
node --import tsx src/web.ts --profile ./web.profile.json
```

```json
{
  "version": 1,
  "patches": [
    { "id": "llm", "config": { "provider": "settings" } }
  ]
}
```

Web 还提供插件启停、配置保存和教学版热重载。热重载会先卸载旧 Fiber，再挂载新配置；当前不监听插件源码变化。

## 已实现能力

### 会话与 Agent

- JSONL 仅追加事件、稳定 `seq`、损坏与截断恢复、订阅和边界 fork
- 从事件投影模型消息、聊天 transcript、统计和当前目标
- `turn`、`step`、模型 request attempt 的开始与终态
- 持久 inbox：`followup()` 开启 turn，`inject()` 在下个 step 边界领取
- `preStep` 允许、改写或拒绝提案
- 协作式取消、错误分类和有界指数退避
- 流式文本、推理、工具参数、usage 与结束原因保真
- system prompt 动态组装、上下文计量、工具结果剪枝和持久压缩事件

### 工具与执行

默认工具表包含：

| 类别 | 工具 |
|---|---|
| 基础 | `echo` |
| 工作区 | `read_file`、`list_files`、`write_file`、`edit`、`grep` |
| Shell | `bash` |
| 委派 | `subagent` |
| 后台任务 | `job`、`job_output`、`job_kill` |
| 会话目标 | `get_goal`、`create_goal`、`complete_goal` |
| MCP（启用插件后） | `mcp__demo__ping` |

所有工具统一经过 `preExecute → execute → postExecute`。拒绝、未知工具、执行异常和后置阻断都会写成结构化 `tool_result`，供模型看到，不会直接伪造整个 turn 成功。

连续 `parallel` 工具最多并发 4 个；`exclusive` 工具构成双向 barrier。执行可以乱序完成，但结果按模型调用顺序写入。工具还可声明超时，超时后等待 executor 协作式停稳再返回 `TOOL_TIMEOUT`。

文件操作检查词法路径与 realpath，写入使用临时文件加 rename。macOS/Linux 使用 `bash`，Windows 使用 `pwsh`；两者只消费 `ctx.shell`。默认沙箱目前只有 macOS Seatbelt，Windows 受限模式会失败关闭，只有明确选择 `danger-full-access` 才允许 PowerShell 无沙箱执行。审批只允许单次授权，询问和决定都进入审计事件。

### 子 Agent、job 与 goal

- `subagent`：前台等待、独立子会话，可用 `childId` 继续；子级禁止嵌套委派、写文件、job 和 goal。
- `job`：后台启动子 Agent 并立即返回 `jobId`；通过 output 查询，通过 kill 取消；结果留在 job 子会话。
- `goal`：当前会话最多一个目标，以 `goal_change` 完整快照事件保存并折叠读取，不进入模型消息投影。

这些能力都通过注册表和 service seam 接入，Agent Loop 不按工具名分支。

## 架构入口

```text
Web / SSE
  → Agent（turn、step、inbox、取消）
  → SessionStore（JSONL 事实）
  → projectMessages + system prompt + tools
  → OpenAI-compatible LLM
  → ToolRegistry（策略、审批、超时、调度）
  → fs / shell / sandbox / MCP / subagent / jobs / goals
  → 结果追加回 SessionStore
```

主要文件：

- `src/session.ts`：事件类型和投影
- `src/session-store.ts`、`src/session-persistence.ts`：缓存、序号和持久化 seam
- `src/agent.ts`、`src/loop.ts`：生命周期与多步循环
- `src/llm.ts`：OpenAI-compatible 流式适配器
- `src/tools.ts`、`src/tools-service.ts`：注册表、流水线和调度
- `src/composition.ts`、`src/plugins.ts`：Cordis service 装配和插件贡献
- `src/web.ts`：HTTP/SSE、会话与设置 API

更完整的流程和能力边界见 [`docs/技术架构.md`](docs/技术架构.md)，逐文件源码导读见 [`docs/source/README.md`](docs/source/README.md)。

## 明确边界

当前实现有意保持最小：

- MCP 只有进程内教学 Provider，没有 stdio/HTTP 传输、自动重连和生产服务器管理。
- 沙箱仅实现 macOS Seatbelt；Windows 已支持 PowerShell，但尚无 Win32 ACL 沙箱，Linux 也没有 Landlock/bwrap。
- `bash` 是有界前台执行；后台 job 的生产者是子 Agent，不是通用 shell job。
- goal 只有 create/get/complete，没有暂停、阻塞、预算、自动续跑和多目标。
- 子 Agent 在同一进程内运行，没有 ACP/Codex 外部代理协议。
- `write_file` 是整文件覆盖；`edit` 是字面量替换，没有版本检查或冲突合并。

## 联系作者

如果你正在研究 Agent 工程、准备基于 LOB Harness 做扩展，或希望交流实际项目，可以扫码添加作者微信。添加时请备注 `LOB Harness`。

<img src="assets/wechat-qr.png" alt="虾哥微信二维码" width="280">
