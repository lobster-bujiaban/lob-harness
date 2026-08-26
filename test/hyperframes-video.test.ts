import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { analyzeSource, createHyperframesProject, type HyperframesPlan } from "../src/hyperframes-video.ts";

const plan: HyperframesPlan = {
  slug: "demo-agent",
  projectName: "Demo Agent",
  audienceQuestion: "Agent 中断后为什么还能继续？",
  searchableTitle: "Agent 中断恢复原理：事件日志与状态投影",
  searchKeywords: ["Agent 原理", "断点恢复"],
  saveValue: ["恢复链路", "适用边界"],
  seriesNext: "工具调用如何恢复",
  scenes: [
    { id: "hook", title: "为什么会中断？", narration: "先看问题。", duration: 10, template: "hook" },
    { id: "flow", title: "事件留下事实", narration: "再看主链路。", duration: 10, template: "flow", bullets: ["写入事件", "重新投影"] },
    { id: "boundary", title: "适用边界", narration: "最后记住边界。", duration: 10, template: "boundary" },
  ],
};

test("源码分析返回有界摘要，不扫描依赖目录", async () => {
  const root = await mkdtemp(join(tmpdir(), "hyperframes-source-"));
  await writeFile(join(root, "README.md"), "# Demo\nAgent event runtime");
  await writeFile(join(root, "agent-service.ts"), "export class AgentService { run() {} }");
  const digest = await analyzeSource(root, new AbortController().signal);
  expect(digest.project).toBe(root.split("/").at(-1));
  expect(digest.scannedFiles).toBe(2);
  expect(digest.evidence).toHaveLength(1);
});

test("结构化方案生成完整 Hyperframes 工程", async () => {
  const root = await mkdtemp(join(tmpdir(), "hyperframes-project-"));
  const output = join(root, "video");
  const result = await createHyperframesProject(root, output, plan, new AbortController().signal);
  expect(result).toMatchObject({ status: "created", scenes: 3, duration: 30 });
  expect(JSON.parse(await readFile(join(output, "package.json"), "utf8")).scripts.render)
    .toContain("renders/demo-agent.mp4");
  expect(await readFile(join(output, "compositions", "frames", "hook.html"), "utf8"))
    .toContain('class="clip head"');
  expect(await readFile(join(output, "index.html"), "utf8")).toContain('data-width="1080"');
  expect(await readFile(join(output, "发布文案.md"), "utf8")).toContain("#Agent原理");
  expect(result.contentChecks).toMatchObject({ keywords: true, saveValue: true, seriesContinuation: true });
});
