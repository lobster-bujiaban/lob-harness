import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { analyzeSource, createHyperframesProject, generateVoice, installHyperframesVideo, type HyperframesPlan } from "../src/hyperframes-video.ts";
import type { ShellProvider } from "../src/shell-service.ts";
import { ToolRegistry } from "../src/tools.ts";

const plan: HyperframesPlan = {
  slug: "demo-agent",
  projectName: "Demo Agent",
  projectIdentity: "Demo Agent 是一个使用事件日志恢复运行状态的示例 Agent 框架。",
  sourcePath: ".",
  creatorName: "虾哥不加班",
  repositoryUrl: "https://github.com/lobster-bujiaban/demo-agent",
  logoPath: "web/lobster-logo.png",
  requireNarration: true,
  audienceQuestion: "Agent 中断后为什么还能继续？",
  searchableTitle: "Agent 中断恢复原理：事件日志与状态投影",
  searchKeywords: ["Agent 原理", "断点恢复"],
  saveValue: ["恢复链路", "适用边界"],
  seriesNext: "工具调用如何恢复",
  scenes: [
    { id: "hook", title: "Demo Agent 为什么会中断？", narration: "先看 Demo Agent 的问题。", duration: 10, template: "hook" },
    {
      id: "flow", title: "事件留下事实", narration: "再看主链路。", duration: 10, template: "flow", bullets: ["写入事件", "重新投影"],
      evidence: [
        { file: "agent-service.ts", lineStart: 1, lineEnd: 1, claim: "Agent 由服务启动", kind: "fact" },
        { file: "session-store.ts", lineStart: 1, lineEnd: 1, claim: "会话状态写入事件", kind: "fact" },
      ],
    },
    { id: "boundary", title: "适用边界", narration: "最后记住边界。", duration: 10, template: "boundary" },
  ],
};

async function prepareProject(root: string): Promise<void> {
  await mkdir(join(root, "web"), { recursive: true });
  await writeFile(join(root, "web", "lobster-logo.png"), new Uint8Array([137, 80, 78, 71]));
  await writeFile(join(root, "agent-service.ts"), "export class AgentService {}\n");
  await writeFile(join(root, "session-store.ts"), "export class SessionStore {}\n");
}

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
  await prepareProject(root);
  const output = join(root, "video");
  const result = await createHyperframesProject(root, output, plan, new AbortController().signal);
  expect(result).toMatchObject({ status: "created", scenes: 3, duration: 30 });
  expect(JSON.parse(await readFile(join(output, "package.json"), "utf8")).scripts.render)
    .toContain("renders/demo-agent.mp4");
  expect(await readFile(join(output, "compositions", "frames", "hook.html"), "utf8"))
    .toContain('class="clip head"');
  expect(await readFile(join(output, "index.html"), "utf8")).toContain('data-width="1080"');
  expect(await readFile(join(output, "发布文案.md"), "utf8")).toContain("#Agent原理");
  expect(await readFile(join(output, "compositions", "frames", "flow.html"), "utf8")).toContain("agent-service.ts · L1–1");
  expect(result.contentChecks).toMatchObject({ keywords: true, saveValue: true, seriesContinuation: true, creatorVisible: true, qrCodeAbsent: true });
});

test("配音按真实时长回写工程并持久化音色", async () => {
  const root = await mkdtemp(join(tmpdir(), "hyperframes-voice-"));
  await prepareProject(root);
  const output = join(root, "video");
  await createHyperframesProject(root, output, plan, new AbortController().signal);
  const shell: ShellProvider = {
    async run() {
      return { exitCode: 0, signal: null, stdout: "9.65\n", stderr: "", truncated: false, timedOut: false, aborted: false };
    },
  };
  const result = await generateVoice(output, {
    shell,
    signal: new AbortController().signal,
    voices: ["longanyang"],
    model: "cosyvoice-v3-flash",
    synthesize: async () => new Uint8Array([1, 2, 3]),
  });
  expect(result).toMatchObject({ status: "completed", voice: "longanyang", scenes: 3, duration: 30 });
  expect(JSON.parse(await readFile(join(output, "audio-meta.json"), "utf8"))).toMatchObject({
    provider: "cosyvoice",
    voice: "longanyang",
  });
  expect(JSON.parse(await readFile(join(output, "video-plan.json"), "utf8")).scenes[0]).toMatchObject({
    duration: 10,
    audioPath: "assets/voice/01.mp3",
  });
  expect(await readFile(join(output, "assets", "voice", "01.mp3"))).toEqual(Buffer.from([1, 2, 3]));
});

test("配音文本外发没有审批通道时拒绝执行", async () => {
  const root = await mkdtemp(join(tmpdir(), "hyperframes-voice-approval-"));
  await prepareProject(root);
  const output = join(root, "video");
  await createHyperframesProject(root, output, plan, new AbortController().signal);
  const registry = new ToolRegistry();
  installHyperframesVideo(registry, {
    root,
    shell: { async run() { throw new Error("不应执行"); } },
    synthesizeVoice: async () => { throw new Error("不应外发"); },
  });
  const result = await registry.execute("video_generate_voice", { projectDir: "video" }, new AbortController().signal);
  expect(result).toMatchObject({ isError: true, error: { code: "DENIED" } });
  expect(result.output).toContain("no approval channel is available");
});
