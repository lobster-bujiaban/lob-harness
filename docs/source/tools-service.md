# `src/tools-service.ts`

## 职责

把各插件贡献的工具安装器汇总为逐会话、逐工作区的 ToolRegistry。

## 主流程

插件通过 `contribute()` 注册 `ToolContribution`；创建 Registry 时按 scope 安装贡献，并叠加根目录策略和审批审计。贡献卸载后，新 Registry 不再包含它。

## 子级约束

`CHILD_TOOL_EXCLUDE` 排除 subagent、write_file、edit、job 和 goal 工具，使子 Agent 保持只读且不能递归委派。

## 设计取舍

Registry 属于具体会话 scope，Service 保存的是构建能力，不共享带状态的全局工具表。

## 关联测试

`test/tools-service.test.ts`、`test/plugins.test.ts`。
