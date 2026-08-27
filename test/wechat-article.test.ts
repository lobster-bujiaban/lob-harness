import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createDefaultToolRegistry } from "../src/tools.ts";
import { installWechatArticle } from "../src/wechat-article.ts";

test("结构化方案渲染成带图解、发布助手和一键复制的单文件 HTML", async () => {
  const root = await mkdtemp(join(tmpdir(), "lob-wechat-article-"));
  const registry = createDefaultToolRegistry();
  installWechatArticle(registry, { root });
  const paragraph = "真正难的不是把模型接进来，而是让一次执行留下可恢复的事实。事件日志记录发生过什么，投影负责决定模型现在看见什么，这个边界让失败可以复盘，也让架构取舍能够被普通开发者理解。";
  const result = await registry.execute("wechat_create_article", {
    outputDir: "wechat",
    plan: {
      title: "我为什么重新写了一遍 Agent 的运行骨架",
      subtitle: "从长期交付回到一线代码，我想补上的不是另一个聊天框，而是失败之后还能继续的运行时。",
      projectName: "LOB Harness",
      repositoryUrl: "https://github.com/lobster-bujiaban/lob-harness",
      opening: [paragraph, paragraph],
      journey: [
        { title: "长期交付", text: "先学会对边界和失败负责。" },
        { title: "源码拆解", text: "不再满足于只会调用 API。" },
        { title: "开源骨架", text: "把隐含经验变成能运行的样本。" },
      ],
      mechanism: {
        title: "一次请求如何留下可恢复的轨迹",
        steps: [
          { title: "用户输入", text: "输入先成为一条持久事件" },
          { title: "模型与工具", text: "每一步结果都继续追加成事实" },
          { title: "重新投影", text: "失败后根据完整事实恢复上下文" },
        ],
      },
      comparison: {
        beforeTitle: "只存聊天记录",
        before: ["中断现场丢失", "工具边界模糊"],
        afterTitle: "只追加事件",
        after: ["任意前缀可回放", "状态从事实重建"],
      },
      sections: [
        { title: "演示结束后，问题才开始", paragraphs: [paragraph, paragraph], takeaway: "能恢复，才算真正开始交付。" },
        { title: "开源迫使我把经验说清楚", paragraphs: [paragraph, paragraph] },
      ],
      quote: "我想开源的不是答案，而是一套能被运行、质疑和修改的判断过程。",
      closing: { summary: paragraph, question: "你更在意 Agent 的能力上限，还是失败后的恢复能力？" },
      publish: {
        titles: ["为什么我要重新理解 Agent 运行时", "事件日志如何让 Agent 重新开始", "从长期交付到写下开源运行骨架"],
        abstract: "一篇关于 Agent 运行时、事件日志与职业选择的开源手记。",
        tags: ["Agent", "开源", "AI应用架构"],
        shareCopy: "把多年交付里的边界意识，写进一个可以回放和恢复的 Agent 骨架。",
        coverPrompt: "纸面手绘风格，以事件日志到状态投影的流程图为主体，使用项目 Logo，不要机器人和二维码。",
      },
      evidence: [
        { claim: "会话事实保存在只追加事件流中", source: "src/session-store.ts:30" },
        { claim: "模型消息始终从历史事件重新投影", source: "src/session.ts:138" },
        { claim: "回放与恢复行为有独立测试验证", source: "test/replay.test.ts:47" },
      ],
    },
  }, new AbortController().signal);

  expect(JSON.parse(result.output)).toMatchObject({ status: "created", visualModules: 4 });
  const html = await readFile(join(root, "wechat", "article.html"), "utf8");
  const publishCopy = await readFile(join(root, "wechat", "发布文案.md"), "utf8");
  expect(html).toContain("一键复制正文");
  expect(html).toContain("这条路，不是从 Agent 开始的");
  expect(html).toContain("发布助手");
  expect(html).toContain("ClipboardItem");
  expect(html).toContain("text/html");
  expect(html).toContain("a.innerHTML");
  expect(html).toContain("https://github.com/lobster-bujiaban/lob-harness");
  expect(html).not.toContain("去 GitHub 看源码");
  const article = html.match(/<article id="article">([\s\S]*?)<\/article>/)?.[1] ?? "";
  expect(article).toContain("<table");
  expect(article).not.toContain("<h1");
  expect(article).not.toContain("display:flex");
  expect(article).not.toContain("display:grid");
  expect(article).not.toContain("我为什么重新写了一遍 Agent 的运行骨架");
  expect(publishCopy).toContain("## 标题");
  expect(publishCopy).toContain("## 作者");
  expect(publishCopy).toContain("虾哥不加班");
  expect(publishCopy).toContain("## 摘要（不超过 120 字）");
  expect(publishCopy).toContain("## 封面提示词");
  expect(publishCopy).not.toContain("朋友圈文案");
});
