# `src/web.ts`

## 职责

LOB Harness 的 Web 产品入口，负责 HTTP 路由、SSE、静态资源和桌面目录选择，不承载 Agent 核心规则。

## 主流程

`createWebServer()` 创建持久化、模型设置、Cordis Context 和插件仓库；`handleRequest()` 把请求转成 session、agent、plugin 等 service 调用。直接运行时解析 `--profile`、`--dump-config` 和 `PORT`。

## 关键点

- `tmp` 会话可写，`fixtures` 会话只读。
- turn 接口创建或复用逐会话 Agent，再通过 SSE 推送事件与状态。
- workspace 切换先做 canonical path 校验，运行中的 Agent 禁止切换。
- 设置接口永远不返回明文 API Key。

## 关联测试

`test/web.test.ts`、`test/project.test.ts`。
