# `src/mcp.ts`

## 职责

定义最小 MCP Session seam，并把发现到的远端工具注册进本地 ToolRegistry。

## 主流程

`contributeMcpTools()` 发现 schema；`installMcpTools()` 将公开名称转换为 `mcp__<server>__<tool>`，executor 调用时仍向 Session 发送原始工具名。

## 当前实现

`MemoryMcpSession` 是进程内教学 Provider，`createDemoMcpSession()` 提供 ping 工具。它用于证明远端工具与本地工具共享流水线，不代表完整 stdio/HTTP MCP transport。

断连或卸载只移除 MCP 贡献，不影响本地工具。

## 关联测试

`test/mcp.test.ts`。
