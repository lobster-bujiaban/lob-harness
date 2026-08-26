# `src/composition.ts`

## 职责

定义 Web 产品配置树，并把 Provider 组装成 Cordis Context 中的稳定 Service。

## 主流程

`loadWebConfig()` 产生 `base + web-server`；`applyProfilePatch()` 按 entry id 替换完整 config；`assembleWebContext()` 按配置顺序安装 session、LLM、fs、shell、sandbox、Agent 等服务。

Shell Provider 根据 `platform` 选择：Windows 使用 PowerShell，其他平台使用 Bash。`platform` 可注入，使 Windows 装配可以在非 Windows CI 中验证。

## 设计取舍

- profile 是整项替换，不做容易产生歧义的深合并。
- 配置 dump 与真实启动共享同一棵树。
- 工具插件是 `tools` 的 children，不进入 Agent Loop。
- Provider 在装配边界选择，Consumer 只读取 `ctx.<service>`。

## 关联测试

`test/composition.test.ts`。
