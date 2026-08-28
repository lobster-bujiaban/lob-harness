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

每个临时会话可以选择独立的工作区根目录。选择结果以 `workspace_root` 事件持久化，后续 turn 会按该目录重组工具；Agent 运行中不能切换工作区。macOS 和 Windows 可使用原生目录选择器。

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
| 公众号 | `wechat_create_article` |
| MCP（启用插件后） | `mcp__demo__ping` |

所有工具统一经过 `preExecute → execute → postExecute`。拒绝、未知工具、执行异常和后置阻断都会写成结构化 `tool_result`，供模型看到，不会直接伪造整个 turn 成功。

### 源码转 Hyperframes 视频

内置 `Hyperframes Video` 插件把视频制作收敛为四个高层工具：先对当前工作区的完整项目做有界摘要，再由 Agent 生成带源码证据的 3～16 个结构化场景，最后创建、配音并渲染 1080×1920 的 Hyperframes 工程。分析默认排除 `videos`、`tmp`、依赖和构建目录。视频允许 30 秒到 20 分钟，时长由讲透问题所需的信息决定。工程固定使用 `hyperframes@0.7.108`，写在工作区的 `videos/` 下，成片为 `videos/renders/<slug>.mp4`。

视频方案可填写 `audienceQuestion`、`searchableTitle`、`searchKeywords`、`saveValue` 和 `seriesNext`。插件据此生成搜索友好的发布文案、项目专属封面提示词、可收藏价值检查和系列承接。

需要有声成片时，可以在场景的 `audioPath` 中提供工作区内的本地音频，也可以调用 `video_generate_voice`。后者从插件配置的 CosyVoice v3 音色池随机选择一个音色，同一工程再次生成时沿用该音色；API Key 优先读取 `tmp/config/credentials.json` 的 `dashscopeApiKey`，并兼容环境变量 `DASHSCOPE_API_KEY`。配音直接外发到阿里云百炼，不再等待审批。渲染以 `danger-full-access` 执行，并把 npm 缓存和临时目录放在工程内，避免 Seatbelt 拦住 Puppeteer。典型调用顺序：

```text
video_analyze_source → video_create_hyperframes → video_generate_voice → video_render_hyperframes
```

源码、输出目录和音频路径都必须位于当前会话工作区内；渲染只向模型返回末尾摘要日志，避免 Hyperframes/FFmpeg 输出占满上下文。

### Web 一键生成宣传内容

Web 输入框左下角「+」菜单提供「生成宣传视频」和「生成公众号文章」。两个入口都会读取当前选中工作区的源码、自动新建会话并发送内置提示词，不需要手工复制提示词。使用前先在左侧选择正确的源码工作区，并保持权限为 `Workspace Write`，否则 Agent 无法写入交付文件。

#### 生成宣传视频

1. 在 Web 设置中配置可用的对话模型；需要自动配音时，再在 `tmp/config/credentials.json` 配置 `dashscopeApiKey`，或设置 `DASHSCOPE_API_KEY`。
2. 选择需要宣传的源码工作区，点击输入框左下角「+」→「生成宣传视频」。
3. Agent 会分析 README、manifest、源码、测试、Git remote 和 Logo，生成带源码证据的视频方案，然后依次创建 Hyperframes 工程、生成配音并渲染成片。
4. 渲染完成后到 `videos/renders/<slug>.mp4` 查看有声竖版视频；`videos/` 还包含视频方案、发布文案、封面提示词、证据清单和可继续编辑的 Hyperframes 工程。

只有 Agent 明确报告 MP4 非空、全部场景均有音频时才算完成。配音会调用阿里云百炼，渲染需要下载 Hyperframes 依赖并以 `danger-full-access` 执行；遇到审批时需确认后才能继续。重复生成会继续使用工作区内的 `videos/`，需要保留旧结果时应先自行备份或改名。

内置提示词可通过 `GET /api/prompts/promo-video` 查看。

#### 生成公众号文章

1. 可选：把作者原始简历放在 `tmp/config/作者简历.pdf`，并准备脱敏后的 `tmp/config/resume-context.md`。本项目本地环境已内置这两份文件；`tmp/` 已被 Git 忽略，不会提交简历。脱敏上下文不得包含电话、邮箱、薪资等不应公开的信息。
2. 选择需要介绍的源码工作区，点击输入框左下角「+」→「生成公众号文章」。
3. Agent 先用一次有界源码分析、脱敏职业背景和精简 Git 历史确定这篇独有的判断，只在缺少关键证据时额外读取最多两个源码文件。随后生成约 2000～5000 字的结构化文章方案，不做全仓逐文件审计。
4. 专用的 `wechat_create_article` 工具把结构化方案渲染为 `wechat/article.html`。模型不再手写大段 HTML/CSS/JS，因此消耗更低，页面风格也保持稳定。
5. 完成后打开 `wechat/article.html`：正文仍包含时间线、机制流程、前后对照和取舍卡，但小标题与模块顺序随项目变化，避免每篇同一套叙事壳；桌面端右侧「发布助手」提供标题候选、摘要、标签、朋友圈文案、封面提示词和折叠证据。右上角「一键复制正文」只复制带内联样式的文章富文本，可直接粘贴到微信公众号编辑器。

公众号交付 `wechat/article.html` 和 `wechat/发布文案.md`。后者只包含最终标题、120 字以内摘要和封面提示词，其余发布信息与证据放在 HTML 的发布助手中。发布前应人工确认个人经历、项目数据、GitHub 地址、封面和事实证据。重复生成会覆盖同一路径，需要保留旧版本时应先备份或改名。

内置提示词可通过 `GET /api/prompts/wechat-article` 查看。

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

## 许可证

本项目基于 [Apache License 2.0](LICENSE) 开源。
