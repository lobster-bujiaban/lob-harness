# `src/session.ts`

## 职责

定义全部会话事件、标准模型消息，以及从事件折叠出的各种 Projection。

## 核心投影

- `projectMessages()`：生成模型可见的 user、assistant、tool 消息。
- `deriveWorkspaceRoot()`：得到当前工作区。
- `deriveInbox()`：恢复尚未领取的输入。
- `deriveLifecycle()`：诊断 turn/step 状态与编号。

## 设计取舍

事件是已发生事实，投影是可重算视图。生命周期、审批、job、goal 等控制事件不会直接进入模型历史；工具 call/result 必须通过稳定 id 配对。

文件底部的兼容 `append/load` 通过 persistence seam 工作，不另造存储协议。

## 关联测试

`test/session.test.ts`、`test/replay.test.ts`、`test/lifecycle.test.ts`。
