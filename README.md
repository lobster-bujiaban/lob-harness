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

项目使用 OpenAI-compatible Chat Completions SSE 协议。Web 设置支持多个模型提供方并存；每个配置拥有稳定 ID、显示名称、API 地址、模型名称和独立 API Key。顶部模型选择器切换完整配置，每轮请求前重新读取，因此保存或切换后无需重启。

- 普通配置：`tmp/config/llm-settings.json`（`version: 2`，保存 `activeProfileId` 和 `profiles`）
- 凭据：`tmp/config/credentials.json`（各模型 Key 保存在 `modelApiKeys`，配音 Key 使用 `dashscopeApiKey`）
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
| 视频 | `video_analyze_source`、`video_create_hyperframes`、`video_generate_voice`、`video_render_hyperframes` |
| MCP（启用插件后） | `mcp__demo__ping` |

所有工具统一经过 `preExecute → execute → postExecute`。拒绝、未知工具、执行异常和后置阻断都会写成结构化 `tool_result`，供模型看到，不会直接伪造整个 turn 成功。

### 源码转 Hyperframes 视频

内置 `Hyperframes Video` 插件把视频制作收敛为四个高层工具：先对当前工作区的完整项目做有界摘要，再由 Agent 生成带源码证据的 3～16 个结构化场景，最后创建、配音并渲染 1080×1920 的 Hyperframes 工程。分析默认排除 `videos`、`tmp`、依赖和构建目录。视频允许 30 秒到 20 分钟，时长由讲透问题所需的信息决定。工程固定使用 `hyperframes@0.7.108`，输出到项目的 `renders/<slug>.mp4`。

视频方案可填写 `audienceQuestion`、`searchableTitle`、`searchKeywords`、`saveValue` 和 `seriesNext`。插件据此生成搜索友好的发布文案、可收藏价值检查和系列承接。

需要有声成片时，可以在场景的 `audioPath` 中提供工作区内的本地音频，也可以调用 `video_generate_voice`。后者从插件配置的 CosyVoice v3 音色池随机选择一个音色，同一工程再次生成时沿用该音色；API Key 优先读取 `tmp/config/credentials.json` 的 `dashscopeApiKey`，并兼容环境变量 `DASHSCOPE_API_KEY`。由于旁白会发送到阿里云百炼，工具每次执行前都会要求审批。典型调用顺序：

```text
video_analyze_source → video_create_hyperframes → video_generate_voice → video_render_hyperframes
```

源码、输出目录和音频路径都必须位于当前会话工作区内；渲染只向模型返回末尾摘要日志，避免 Hyperframes/FFmpeg 输出占满上下文。

可直接在选择源码工作区后使用下面的提示词：

```text
请分析当前工作区的完整项目，制作一条适合抖音发布的 lob-harness 源码拆解视频，最终交付有声 MP4。

输入：
- 源码范围：当前工作区全部内容
- 输出根目录：videos
- 本期工程标识：lob-harness（插件生成到 videos/lob-harness）
- 项目 GitHub：https://github.com/lobster-bujiaban/lob-harness
- 项目作者：虾哥不加班
- 项目 Logo：web/lobster-logo.png
- 本地音频目录：无

要求：
1. 先调用 `video_analyze_source`，不传 path，默认分析当前工作区全部内容。先根据 README、package.json、入口文件和 Git remote 确认 lob-harness 是什么，再选择一个属于本项目自身、用户会主动搜索且有工程价值的核心问题；不要把通用 Agent 安全话题或功能列表当成项目拆解。
2. 方案必须填写 `slug: "lob-harness"`、`projectName: "lob-harness"`、`projectIdentity`、`sourcePath: "."`、searchableTitle、audienceQuestion、2～8 个 searchKeywords、至少 2 个 saveValue 和 seriesNext。第一幕的标题或口播必须明确出现 `lob-harness`。
3. 每个技术场景必须提供 `evidence`，每条包含真实的 `file`、`lineStart`、`lineEnd`、`claim` 和 `kind`。kind 只能是 fact、boundary 或 hypothetical；风险设想不得写成已经发生的事实。至少引用 2 个相互关联的源码文件，单条证据不超过 40 行。
4. 只陈述源码能够证明的事实。禁止把可选配置写成默认启用、把仅限制写入描述成全面隔离，也禁止使用“完全防住”“任何密钥”“绝不会”等超出证据的表达。
5. 正文依次讲清项目定位、现象、源码主链路、关键机制、适用边界和可执行结论。根据复杂度选择 3～16 个场景，总时长 30 秒～20 分钟，并至少使用 3 种 hook、flow、compare、points、boundary 画面类型。
6. 第一帧必须出现项目 Logo、`lob-harness`、`虾哥公开研发` 和 `github.com/lobster-bujiaban/lob-harness`；全片保留项目 Logo、`虾哥不加班` 和 GitHub 文字角标；结尾引导用户在 GitHub 搜索 `lobster-bujiaban/lob-harness` 并关注“虾哥不加班”。
7. 品牌视觉只允许使用当前仓库的 `web/lobster-logo.png`。严禁二维码、扫码引导、二维码字段和其他 Logo。
8. 调用 `video_create_hyperframes`，传入 `outputDir: "videos"`；插件按 slug 自动创建 `videos/lob-harness`。如果返回 `needs_revision` 或任一硬检查失败，必须修订方案后重新创建，不能继续渲染。
9. 当前没有本地音频；取得本次旁白文本外发审批后调用 `video_generate_voice`。审批不可用、配音失败或任何场景缺少音频时，不得声称交付完成。
10. 调用 `video_render_hyperframes` 完成 check 和 render。只有工具真实返回非空 MP4 且 audioScenes 等于 totalScenes 时才算完成；最终报告 MP4、文件大小、发布文案、视频方案和源码证据清单的真实路径。
```

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
