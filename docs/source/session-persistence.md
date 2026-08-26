# `src/session-persistence.ts`

## 职责

定义会话持久化 contract，并提供 JSONL 与内存两种实现。

## JSONL Provider

`JsonlSessionPersistence` 负责 load、append、list、delete 和 fork。每个事件一行 JSON；读取时允许修复未完成尾行，但中间损坏必须报错。

## 内存 Provider

`MemorySessionPersistence` 遵循同一接口，用于单测和可替换装配证明。

## 关键点

- Provider 只管理 durable 数据，不负责模型投影。
- session id 经过 basename 约束，避免路径穿越。
- `parseJsonl()` 集中定义格式失败方式。

## 关联测试

`test/session-persistence.test.ts`。
