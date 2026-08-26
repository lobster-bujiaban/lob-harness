# `src/llm-settings.ts`

## 职责

管理 Web 中的模型地址、模型名和 API Key，并隔离敏感凭据。

## 存储

- `llm-settings.json` 保存 Provider、地址和模型。
- `credentials.json` 单独保存 API Key。
- 两个文件都使用受限权限和原子替换。

## 主流程

`describe()` 返回公开设置与 `hasApiKey`；`update()` 校验并保存变更；`createClient()` 在每轮请求前读取最新设置并创建模型客户端。

空 API Key 表示保留已保存密钥，而不是清空。明文密钥不会从设置 API 回传。

## 关联测试

`test/llm-settings.test.ts`。
