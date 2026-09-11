# `src/session-store.ts`

## 职责

在持久化 Provider 之上提供缓存、串行追加、稳定序号、订阅与 fork 协调。

## 主流程

首次读取从 Provider 加载并经 `sequenceAndValidate()` 校验；append 为事件补 `seq`，写盘成功后更新缓存并通知订阅者；同一 session 的写入通过队列串行化。

## 关键点

- 拒绝重复 seq、缺口和非法起点。
- 缓存只保存已成功持久化的事件。
- `sessionStoreFor()` 保证同一 Provider 复用 Store。
- `forkSession()` 复制指定边界前历史，父子之后独立。

## 关联测试

`test/session-service.test.ts`、`test/session-persistence.test.ts`。
