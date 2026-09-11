# `src/system-prompt.ts`

## 职责

提供可动态贡献、排序和卸载的系统提示词 Registry，并通过 Cordis Service 暴露。

## 主流程

`register()` 按 section id 保存文本和 order，并返回幂等 disposer；`render()` 按 order 和注册顺序拼接当前 sections；Agent 每次模型请求前重新读取。

## 设计取舍

系统提示词是动态装配结果，不是会话事实。插件卸载后下一 step 立即看不到对应 section，因此不需要修改历史事件。Web 默认注册一段编码助手说明：用 grep 搜代码、edit 改文件、HTTP 5xx 先查服务端空用户。有 `workspace_root` 时每次请求注入 `~/.dsh/AGENTS.md` 与工作区 `AGENTS.md`。剩余步数 ≤ 5 时 Loop 会追加收尾约束。

## 关联测试

`test/system-prompt-service.test.ts`、`test/composition.test.ts`、`test/loop.test.ts`、`test/steps.test.ts`。
