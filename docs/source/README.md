# 源码导读

这里为承载核心机制的 `src/*.ts` 文件各写一篇独立说明。建议先读技术架构，再按下面顺序进入源码。

## 推荐顺序

1. 入口与组装：[`web.ts`](web.md) → [`composition.ts`](composition.md) → [`plugins.ts`](plugins.md)
2. 主循环：[`agent.ts`](agent.md) → [`loop.ts`](loop.md)
3. 会话：[`session.ts`](session.md) → [`session-store.ts`](session-store.md) → [`session-persistence.ts`](session-persistence.md)
4. 模型与上下文：[`llm.ts`](llm.md) → [`sse.ts`](sse.md) → [`llm-settings.ts`](llm-settings.md) → [`context.ts`](context.md) → [`system-prompt.ts`](system-prompt.md) → [`retry.ts`](retry.md) → [`errors.ts`](errors.md)
5. 工具：[`tools.ts`](tools.md) → [`tools-service.ts`](tools-service.md) → [`files.ts`](files.md) → [`fs-service.ts`](fs-service.md) → [`bash.ts`](bash.md)
6. 执行环境：[`subprocess-service.ts`](subprocess-service.md) → [`shell-service.ts`](shell-service.md) → [`sandbox-service.ts`](sandbox-service.md)
7. 扩展能力：[`mcp.ts`](mcp.md) → [`subagent.ts`](subagent.md) → [`subagent-service.ts`](subagent-service.md) → [`jobs.ts`](jobs.md) → [`jobs-service.ts`](jobs-service.md) → [`goal.ts`](goal.md) → [`goal-service.ts`](goal-service.md)

未单独成篇的文件主要是薄 Service 包装、简单默认值或类型转发，可从相邻核心文档进入。
