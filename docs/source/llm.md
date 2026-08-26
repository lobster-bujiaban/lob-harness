# `src/llm.ts`

## 职责

定义模型适配器接口，并实现 OpenAI-compatible 流式客户端与测试 Fake。

## 主流程

`OpenAiCompatLlm` 把 messages 和 tool schema 转成 Chat Completions 请求，检查 HTTP 状态后解析 SSE，将文本、推理、工具参数、usage 和结束原因输出为类型化 chunk，最后组装 `LlmReply`。

## 错误边界

空响应、超时、限流、上下文溢出和协议异常被转换为稳定 `HarnessError`。API Key 只用于请求头，不进入事件。

`FakeLlm` 按脚本返回确定结果，用于验证 Loop，而不是运行时模型选择。

## 关联测试

`test/llm.test.ts`、`test/openai-compat.test.ts`、`test/sse.test.ts`。
