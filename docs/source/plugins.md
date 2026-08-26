# `src/plugins.ts`

## 职责

管理内置工具插件的清单、启停、配置持久化和 Fiber 生命周期。

## 主流程

`PluginStore` 读取 `plugins.json`，根据 `BUILTIN_PLUGINS` 建立 inventory；启用时创建 Loader Entry，禁用时卸载贡献；reload 先等待旧 Fiber 清理，再挂载新配置。

## 关键点

- manifest 描述身份和配置，inventory 再叠加运行状态。
- 每个工具贡献必须返回 disposer，防止 reload 后重复注册。
- MCP 启动失败可配置为不阻断本地工具。
- 插件配置写盘与运行态切换保持串行。

## 关联测试

`test/plugins.test.ts`。
