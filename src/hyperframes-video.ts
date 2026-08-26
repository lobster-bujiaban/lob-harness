import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ShellProvider } from "./shell-service.ts";
import { ToolError, type ToolRegistry } from "./tools.ts";

const HYPERFRAMES_VERSION = "0.7.108";
const SOURCE_EXTENSIONS = new Set([".c", ".cc", ".cpp", ".cs", ".go", ".java", ".js", ".jsx", ".kt", ".md", ".php", ".py", ".rb", ".rs", ".sh", ".sql", ".ts", ".tsx", ".vue"]);
const IGNORED_DIRECTORIES = new Set([".git", ".idea", ".next", ".turbo", ".venv", "build", "coverage", "dist", "node_modules", "target", "vendor"]);
const ENTRY_NAMES = new Set(["README.md", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "requirements.txt"]);
const MAX_FILES = 2_000;
const MAX_EVIDENCE = 24;

export type VideoScene = {
  id: string;
  title: string;
  narration: string;
  duration: number;
  template?: "hook" | "flow" | "compare" | "points" | "boundary";
  eyebrow?: string;
  bullets?: string[];
  audioPath?: string;
};

export type HyperframesPlan = {
  slug: string;
  projectName: string;
  audienceQuestion?: string;
  searchableTitle?: string;
  searchKeywords?: string[];
  saveValue?: string[];
  seriesNext?: string;
  aiDisclosure?: boolean;
  episode?: string;
  accent?: string;
  background?: string;
  foreground?: string;
  scenes: VideoScene[];
};

export function installHyperframesVideo(
  registry: ToolRegistry,
  options: { root: string; shell: ShellProvider; renderTimeoutMs?: number },
): () => void {
  const root = resolve(options.root);
  const disposers = [
    registry.register({
      name: "video_analyze_source",
      description: "扫描工作区内的源码目录，返回适合短视频选题的紧凑结构摘要；不会返回整个仓库内容。",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "源码目录，绝对路径或相对工作区路径" } },
        required: ["path"],
        additionalProperties: false,
      },
      executionMode: { kind: "parallel" },
      async execute(args, context) {
        const path = resolveInside(root, requiredString(args, "path"));
        return JSON.stringify(await analyzeSource(path, context.signal), null, 2);
      },
    }),
    registry.register({
      name: "video_create_hyperframes",
      description: "根据结构化视频方案创建可预览、检查和渲染的 1080x1920 Hyperframes 工程。旁白音频必须是本地文件；本工具不会联网生成配音。",
      parameters: {
        type: "object",
        properties: {
          outputDir: { type: "string", description: "工作区内的工程输出目录" },
          plan: { type: "object", description: "视频方案：slug、projectName、scenes；每个场景包含 id/title/narration/duration，可选 bullets/template/audioPath" },
        },
        required: ["outputDir", "plan"],
        additionalProperties: false,
      },
      executionMode: { kind: "exclusive" },
      async execute(args, context) {
        const output = resolveInside(root, requiredString(args, "outputDir"));
        const plan = parsePlan(objectField(args, "plan"));
        const result = await createHyperframesProject(root, output, plan, context.signal);
        return JSON.stringify(result, null, 2);
      },
    }),
    registry.register({
      name: "video_render_hyperframes",
      description: "依次执行 Hyperframes check 和 render，并返回抖音 MP4 路径。渲染日志只保留末尾摘要，避免占用上下文。",
      parameters: {
        type: "object",
        properties: { projectDir: { type: "string", description: "video_create_hyperframes 创建的工作区内项目目录" } },
        required: ["projectDir"],
        additionalProperties: false,
      },
      executionMode: { kind: "exclusive" },
      timeoutMs: options.renderTimeoutMs ?? 1_800_000,
      async execute(args, context) {
        const project = resolveInside(root, requiredString(args, "projectDir"));
        const plan = parsePlan(JSON.parse(await readFile(join(project, "video-plan.json"), "utf8")));
        const output = join(project, "renders", `${plan.slug}.mp4`);
        const result = await options.shell.run({
          command: "npm run check && npm run render",
          cwd: project,
          signal: context.signal,
          timeoutMs: options.renderTimeoutMs ?? 1_800_000,
          maxBytes: 24_000,
        });
        if (result.exitCode !== 0 || result.timedOut || result.aborted) {
          throw new ToolError(`Hyperframes 渲染失败：${tail(result.stderr || result.stdout)}`, result.timedOut ? "VIDEO_RENDER_TIMEOUT" : "VIDEO_RENDER_FAILED");
        }
        const info = await stat(output).catch(() => undefined);
        if (info === undefined || !info.isFile() || info.size === 0) {
          throw new ToolError(`Hyperframes 命令成功，但未生成 ${relative(root, output)}`, "VIDEO_OUTPUT_MISSING");
        }
        return JSON.stringify({ status: "completed", mp4: output, bytes: info.size, log: tail(result.stdout) }, null, 2);
      },
    }),
  ];
  return () => disposers.reverse().forEach((dispose) => dispose());
}

export async function analyzeSource(path: string, signal: AbortSignal) {
  const rootStat = await stat(path).catch(() => undefined);
  if (!rootStat?.isDirectory()) throw new ToolError("源码路径不是目录", "VIDEO_SOURCE_NOT_DIRECTORY");
  const files: string[] = [];
  const languages = new Map<string, number>();
  const evidence: { file: string; excerpt: string }[] = [];
  const manifests: { file: string; excerpt: string }[] = [];
  async function walk(current: string, depth: number): Promise<void> {
    signal.throwIfAborted();
    if (files.length >= MAX_FILES || depth > 8) return;
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) await walk(join(current, entry.name), depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const absolute = join(current, entry.name);
      const rel = relative(path, absolute);
      const ext = extname(entry.name).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(ext) && !ENTRY_NAMES.has(entry.name)) continue;
      files.push(rel);
      languages.set(ext || entry.name, (languages.get(ext || entry.name) ?? 0) + 1);
      const size = (await stat(absolute)).size;
      if (size > 256_000) continue;
      if (ENTRY_NAMES.has(entry.name) && manifests.length < 8) {
        manifests.push({ file: rel, excerpt: compact(await readFile(absolute, "utf8"), 1_500) });
      } else if (evidence.length < MAX_EVIDENCE && /(?:agent|session|event|state|tool|plugin|service|provider|pipeline|workflow|router|controller|engine|runtime)/iu.test(rel)) {
        evidence.push({ file: rel, excerpt: compact(await readFile(absolute, "utf8"), 900) });
      }
    }
  }
  await walk(path, 0);
  return {
    project: basename(path),
    sourcePath: path,
    scannedFiles: files.length,
    truncated: files.length >= MAX_FILES,
    languages: [...languages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => ({ name, count })),
    tree: files.slice(0, 160),
    manifests,
    evidence,
    instruction: "围绕一个用户会主动搜索的问题组织内容，给出可收藏的步骤或判断框架；时长由讲透问题决定。基于证据只选择一个可复述的工程判断，事实不足时再精准读取相关文件。",
  };
}

export async function createHyperframesProject(root: string, output: string, plan: HyperframesPlan, signal: AbortSignal) {
  await mkdir(join(output, "compositions", "frames"), { recursive: true });
  await mkdir(join(output, "assets", "voice"), { recursive: true });
  await mkdir(join(output, "renders"), { recursive: true });
  const normalizedScenes: VideoScene[] = [];
  for (let index = 0; index < plan.scenes.length; index += 1) {
    signal.throwIfAborted();
    const scene = plan.scenes[index]!;
    let audio: string | undefined;
    if (scene.audioPath !== undefined) {
      const source = resolveInside(root, scene.audioPath);
      audio = `assets/voice/${String(index + 1).padStart(2, "0")}${extname(source) || ".mp3"}`;
      await copyFile(source, join(output, audio));
    }
    normalizedScenes.push({ ...scene, ...(audio === undefined ? {} : { audioPath: audio }) });
  }
  const normalized = { ...plan, scenes: normalizedScenes };
  await Promise.all([
    writeFile(join(output, "video-plan.json"), `${JSON.stringify(normalized, null, 2)}\n`),
    writeFile(join(output, "hyperframes.json"), `${JSON.stringify(hyperframesConfig(), null, 2)}\n`),
    writeFile(join(output, "package.json"), `${JSON.stringify(packageConfig(plan.slug), null, 2)}\n`),
    writeFile(join(output, ".gitignore"), "node_modules/\nrenders/\n.hyperframes/\n"),
    writeFile(join(output, "index.html"), renderIndex(normalized)),
    writeFile(join(output, "发布文案.md"), renderPublishCopy(normalized)),
    writeFile(join(output, "compositions", "captions.html"), renderCaptions(normalized)),
    ...normalizedScenes.map((scene, index) => writeFile(join(output, "compositions", "frames", `${scene.id}.html`), renderFrame(normalized, scene, index))),
  ]);
  return {
    status: "created",
    projectDir: output,
    plan: join(output, "video-plan.json"),
    scenes: normalizedScenes.length,
    duration: normalizedScenes.reduce((sum, scene) => sum + scene.duration, 0),
    audio: normalizedScenes.filter((scene) => scene.audioPath !== undefined).length,
    contentChecks: contentChecks(normalized),
    next: "需要旁白时为每个场景提供 audioPath 后重新创建；然后调用 video_render_hyperframes。",
  };
}

function parsePlan(value: unknown): HyperframesPlan {
  if (!isObject(value)) throw new ToolError("plan 必须是对象", "VIDEO_PLAN_INVALID");
  const slug = stringValue(value.slug, "plan.slug");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) throw new ToolError("plan.slug 必须是小写连字符格式", "VIDEO_PLAN_INVALID");
  const projectName = stringValue(value.projectName, "plan.projectName");
  if (!Array.isArray(value.scenes) || value.scenes.length < 3 || value.scenes.length > 16) throw new ToolError("plan.scenes 必须包含 3～16 个场景", "VIDEO_PLAN_INVALID");
  const ids = new Set<string>();
  const scenes = value.scenes.map((raw, index): VideoScene => {
    if (!isObject(raw)) throw new ToolError(`scene ${index + 1} 必须是对象`, "VIDEO_PLAN_INVALID");
    const id = stringValue(raw.id, `scene ${index + 1}.id`);
    if (!/^[a-z][a-z0-9-]*$/u.test(id) || ids.has(id)) throw new ToolError(`scene id 无效或重复: ${id}`, "VIDEO_PLAN_INVALID");
    ids.add(id);
    const duration = Number(raw.duration);
    if (!Number.isFinite(duration) || duration < 3 || duration > 120) throw new ToolError(`scene ${id}.duration 必须是 3～120 秒`, "VIDEO_PLAN_INVALID");
    const bullets = raw.bullets === undefined ? undefined : stringArray(raw.bullets, `scene ${id}.bullets`, 5);
    const template = raw.template === undefined ? undefined : stringValue(raw.template, `scene ${id}.template`) as VideoScene["template"];
    if (template !== undefined && !["hook", "flow", "compare", "points", "boundary"].includes(template)) throw new ToolError(`scene ${id}.template 无效`, "VIDEO_PLAN_INVALID");
    return {
      id,
      title: stringValue(raw.title, `scene ${id}.title`),
      narration: stringValue(raw.narration, `scene ${id}.narration`),
      duration,
      ...(template === undefined ? {} : { template }),
      ...(raw.eyebrow === undefined ? {} : { eyebrow: stringValue(raw.eyebrow, `scene ${id}.eyebrow`) }),
      ...(bullets === undefined ? {} : { bullets }),
      ...(raw.audioPath === undefined ? {} : { audioPath: stringValue(raw.audioPath, `scene ${id}.audioPath`) }),
    };
  });
  const totalDuration = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  if (totalDuration < 30 || totalDuration > 1_200) throw new ToolError("视频总时长必须是 30～1200 秒", "VIDEO_PLAN_INVALID");
  return {
    slug,
    projectName,
    scenes,
    ...(value.audienceQuestion === undefined ? {} : { audienceQuestion: stringValue(value.audienceQuestion, "plan.audienceQuestion") }),
    ...(value.searchableTitle === undefined ? {} : { searchableTitle: stringValue(value.searchableTitle, "plan.searchableTitle") }),
    ...(value.searchKeywords === undefined ? {} : { searchKeywords: stringArray(value.searchKeywords, "plan.searchKeywords", 8) }),
    ...(value.saveValue === undefined ? {} : { saveValue: stringArray(value.saveValue, "plan.saveValue", 8) }),
    ...(value.seriesNext === undefined ? {} : { seriesNext: stringValue(value.seriesNext, "plan.seriesNext") }),
    aiDisclosure: value.aiDisclosure === undefined ? true : booleanValue(value.aiDisclosure, "plan.aiDisclosure"),
    ...(value.episode === undefined ? {} : { episode: stringValue(value.episode, "plan.episode") }),
    ...(value.accent === undefined ? {} : { accent: colorValue(value.accent, "plan.accent") }),
    ...(value.background === undefined ? {} : { background: colorValue(value.background, "plan.background") }),
    ...(value.foreground === undefined ? {} : { foreground: colorValue(value.foreground, "plan.foreground") }),
  };
}

function renderIndex(plan: HyperframesPlan): string {
  let cursor = 0;
  const tracks = plan.scenes.map((scene, index) => {
    const start = cursor; cursor += scene.duration;
    const audio = scene.audioPath === undefined ? "" : `\n      <audio src="${escapeHtml(scene.audioPath)}" data-start="${start.toFixed(3)}" data-duration="${scene.duration.toFixed(3)}" data-track-index="10"></audio>`;
    return `      <div class="scene" data-composition-id="${escapeHtml(scene.id)}" data-composition-src="compositions/frames/${escapeHtml(scene.id)}.html" data-start="${start.toFixed(3)}" data-duration="${scene.duration.toFixed(3)}" data-track-index="${index % 2}"></div>${audio}`;
  }).join("\n");
  return `<!doctype html>\n<html><head><meta charset="UTF-8"><meta name="viewport" content="width=1080,height=1920"><style>*{box-sizing:border-box}html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:#000}.scene{position:absolute;inset:0}</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="${cursor.toFixed(3)}" data-width="1080" data-height="1920">\n${tracks}\n      <div class="scene" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="${cursor.toFixed(3)}" data-track-index="20"></div>\n    </div></body></html>\n`;
}

function renderFrame(plan: HyperframesPlan, scene: VideoScene, index: number): string {
  const accent = plan.accent ?? "#0891B2", bg = plan.background ?? "#F6F6F2", fg = plan.foreground ?? "#141412";
  const bullets = (scene.bullets?.length ? scene.bullets : [scene.narration]).map((item, i) => `<li><b>${String(i + 1).padStart(2, "0")}</b><span>${escapeHtml(item)}</span></li>`).join("");
  return `<template><style>#root{position:absolute;inset:0;width:1080px;height:1920px;overflow:hidden;background:${bg};color:${fg};font-family:Arial,"PingFang SC",sans-serif}.clip{position:absolute}.bg{inset:0;background-image:linear-gradient(${fg}12 1px,transparent 1px),linear-gradient(90deg,${fg}12 1px,transparent 1px);background-size:54px 54px}.brand{left:64px;top:68px;font:24px monospace;letter-spacing:.12em}.head{left:64px;right:64px;top:210px}.eyebrow{color:${accent};font:700 26px monospace;letter-spacing:.16em}.head h1{font-size:92px;line-height:1.08;margin:24px 0 0;max-width:920px}.panel{left:64px;right:64px;top:620px;min-height:720px;padding:58px;background:${fg};color:${bg};border-radius:8px 22px 12px 18px;transform:rotate(-.35deg)}ul{list-style:none;margin:0;padding:0;display:grid;gap:30px}li{display:grid;grid-template-columns:72px 1fr;gap:22px;align-items:start;font-size:43px;line-height:1.35}li b{color:${accent};font:26px monospace;padding-top:10px}.bar{left:64px;right:64px;top:1510px;padding:26px 34px;background:${accent};color:#fff;font-size:36px;line-height:1.3}.page{right:64px;top:68px;font:24px monospace}</style><script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script><div id="root" data-composition-id="${escapeHtml(scene.id)}" data-width="1080" data-height="1920" data-duration="${scene.duration}"><div class="clip bg" data-start="0" data-duration="${scene.duration}" data-track-index="0"></div><div class="clip brand" data-start="0" data-duration="${scene.duration}" data-track-index="1">${escapeHtml(plan.projectName)} · 开源拆解 ${escapeHtml(plan.episode ?? "")}</div><div class="clip page" data-start="0" data-duration="${scene.duration}" data-track-index="1">${String(index + 1).padStart(2, "0")}</div><div id="head" class="clip head" data-start="0" data-duration="${scene.duration}" data-track-index="2"><div class="eyebrow">${escapeHtml(scene.eyebrow ?? scene.template ?? "SOURCE CODE")}</div><h1>${escapeHtml(scene.title)}</h1></div><div id="panel" class="clip panel" data-start="0" data-duration="${scene.duration}" data-track-index="3"><ul>${bullets}</ul></div><div id="bar" class="clip bar" data-start="0" data-duration="${scene.duration}" data-track-index="4">${escapeHtml(scene.narration)}</div></div><script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});tl.fromTo("#head",{y:-36,opacity:0},{y:0,opacity:1,duration:.6,ease:"power3.out"},0);tl.fromTo("#panel",{y:48,opacity:0},{y:0,opacity:1,duration:.7,ease:"power2.out"},.8);tl.fromTo("#bar",{y:28,opacity:0},{y:0,opacity:1,duration:.5,ease:"power2.out"},Math.max(1.8,${scene.duration}*.55));window.__timelines["${escapeJs(scene.id)}"]=tl;</script></template>\n`;
}

function renderCaptions(plan: HyperframesPlan): string {
  let cursor = 0;
  const cues = plan.scenes.map((scene) => { const start = cursor; cursor += scene.duration; return { start, end: cursor, text: scene.narration }; });
  return `<template><style>#root{position:absolute;inset:0;width:1080px;height:1920px;pointer-events:none}.caption{position:absolute;left:90px;right:90px;bottom:120px;padding:18px 26px;background:rgba(0,0,0,.82);color:#fff;border-radius:12px;text-align:center;font:700 46px/1.3 Arial,"PingFang SC",sans-serif}</style><script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script><div id="root" data-composition-id="captions" data-width="1080" data-height="1920" data-duration="${cursor}"><div id="caption" class="clip caption" data-start="0" data-duration="${cursor}" data-track-index="0"></div></div><script>const cues=${JSON.stringify(cues)};const node=document.getElementById("caption");window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});cues.forEach(c=>tl.call(()=>node.textContent=c.text,[],c.start));window.__timelines.captions=tl;</script></template>\n`;
}

function renderPublishCopy(plan: HyperframesPlan): string {
  const title = plan.searchableTitle ?? plan.scenes[0]?.title ?? plan.projectName;
  const keywords = plan.searchKeywords ?? [];
  const saveValue = plan.saveValue ?? [];
  return `# 发布文案\n\n## 标题\n\n${title}\n\n## 描述\n\n${plan.audienceQuestion ?? title}\n\n${saveValue.length > 0 ? `这条视频讲清：${saveValue.join("、")}。建议收藏，遇到类似问题时可以按步骤排查。` : ""}\n\n${keywords.map((keyword) => `#${keyword.replace(/\s+/gu, "")}`).join(" ")}\n\n## 置顶评论\n\n${plan.seriesNext ? `下一期：${plan.seriesNext}。你最想先看哪一步？` : "你在实际项目里遇到过哪一步？欢迎留下具体场景。"}\n\n## 发布检查\n\n- 发布时主动声明内容包含 AI 辅助生成。\n- 标题、口播、字幕自然包含核心搜索词，不堆砌关键词。\n- 发布后保留作品并持续回复有信息量的评论。\n`;
}

function contentChecks(plan: HyperframesPlan) {
  return {
    searchableQuestion: Boolean(plan.audienceQuestion && plan.searchableTitle),
    keywords: (plan.searchKeywords?.length ?? 0) >= 2,
    saveValue: (plan.saveValue?.length ?? 0) >= 2,
    seriesContinuation: Boolean(plan.seriesNext),
    aiDisclosure: plan.aiDisclosure !== false,
    durationMode: plan.scenes.reduce((sum, scene) => sum + scene.duration, 0) > 180 ? "deep-dive" : "compact",
  };
}

function hyperframesConfig() { return { $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry", paths: { blocks: "compositions", components: "compositions/components", assets: "assets" }, media: { autoProxy: true }, skill: "faceless-explainer", authoringSkill: "faceless-explainer" }; }
function packageConfig(slug: string) { return { name: slug, private: true, type: "module", scripts: { dev: `npx --yes hyperframes@${HYPERFRAMES_VERSION} preview`, check: `npx --yes hyperframes@${HYPERFRAMES_VERSION} check`, render: `npx --yes hyperframes@${HYPERFRAMES_VERSION} render --output renders/${slug}.mp4` } }; }
function resolveInside(root: string, input: string) { const target = resolve(root, input); if (target !== root && !target.startsWith(`${root}${sep}`)) throw new ToolError("路径必须位于当前工作区", "VIDEO_PATH_OUTSIDE_WORKSPACE"); return target; }
function requiredString(args: unknown, key: string) { return stringValue(isObject(args) ? args[key] : undefined, key); }
function objectField(args: unknown, key: string) { if (!isObject(args) || !isObject(args[key])) throw new ToolError(`${key} 必须是对象`, "VIDEO_ARGUMENT_INVALID"); return args[key]; }
function stringValue(value: unknown, label: string) { if (typeof value !== "string" || value.trim().length === 0) throw new ToolError(`${label} 必须是非空字符串`, "VIDEO_ARGUMENT_INVALID"); return value.trim(); }
function stringArray(value: unknown, label: string, max: number) { if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== "string" || item.trim().length === 0)) throw new ToolError(`${label} 必须是最多 ${max} 个非空字符串`, "VIDEO_PLAN_INVALID"); return value.map((item) => String(item).trim()); }
function colorValue(value: unknown, label: string) { const color = stringValue(value, label); if (!/^#[0-9a-f]{6}$/iu.test(color)) throw new ToolError(`${label} 必须是六位十六进制颜色`, "VIDEO_PLAN_INVALID"); return color; }
function booleanValue(value: unknown, label: string) { if (typeof value !== "boolean") throw new ToolError(`${label} 必须是布尔值`, "VIDEO_PLAN_INVALID"); return value; }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function compact(text: string, max: number) { return text.replace(/\s+/gu, " ").trim().slice(0, max); }
function escapeHtml(text: string) { return text.replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!); }
function escapeJs(text: string) { return text.replace(/[\\"\n\r]/gu, (char) => ({ "\\": "\\\\", "\"": "\\\"", "\n": "\\n", "\r": "\\r" })[char]!); }
function tail(text: string) { return text.trim().split("\n").slice(-16).join("\n").slice(-4_000); }
