# `src/subagent.ts`

## 职责

定义 subagent 工具的模型参数、运行时接口和结果渲染，不直接创建 Agent。

## 工具行为

首次调用只传 prompt，由 runtime 创建子会话；继续调用同时传 prompt 和 `childId`。`installSubagent()` 注册 exclusive 工具，并把当前 session/workspace 作为 owner 传入 runtime。

## 辅助投影

`lastAssistantOutput()` 提取子会话最终回答；`subagentDescriptorOf()` 读取归属描述；`renderSubagentResult()` 返回模型可理解的 childId、输出和状态。

## 关联测试

`test/subagent.test.ts`。
