import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { SandboxExecutionPolicy } from "./sandbox-service.ts";
import type { ShellProvider } from "./shell-service.ts";
import { ToolError, type ToolRegistry } from "./tools.ts";
import { renderCaptions, renderFrame, resolveVisualTemplate } from "./hyperframes-visual.ts";

const HYPERFRAMES_VERSION = "0.7.108";
const SOURCE_EXTENSIONS = new Set([".c", ".cc", ".cpp", ".cs", ".go", ".java", ".js", ".jsx", ".kt", ".md", ".php", ".py", ".rb", ".rs", ".sh", ".sql", ".ts", ".tsx", ".vue"]);
const IGNORED_DIRECTORIES = new Set([".git", ".idea", ".next", ".turbo", ".venv", "build", "coverage", "dist", "node_modules", "target", "tmp", "vendor", "videos"]);
const ENTRY_NAMES = new Set(["README.md", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "requirements.txt"]);
const MAX_FILES = 2_000;
const MAX_EVIDENCE = 24;
const DEFAULT_VOICES = ["longanlang_v3", "longanyang", "loongbella_v3"] as const;
const DASHSCOPE_TTS_URL = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer";

export type VoiceSynthesizer = (request: {
  text: string;
  voice: string;
  model: string;
  signal: AbortSignal;
}) => Promise<Uint8Array>;

export type VideoScene = {
  id: string;
  title: string;
  narration: string;
  duration: number;
  template?: "hook" | "flow" | "compare" | "points" | "boundary";
  eyebrow?: string;
  bullets?: string[];
  audioPath?: string;
  evidence?: SourceEvidence[];
  sourceLabel?: string;
  sourceExcerpt?: string;
};

export type SourceEvidence = {
  file: string;
  lineStart: number;
  lineEnd: number;
  claim: string;
  kind: "fact" | "boundary" | "hypothetical";
};

export type HyperframesPlan = {
  slug: string;
  projectName: string;
  projectIdentity?: string;
  sourcePath?: string;
  creatorName?: string;
  repositoryUrl?: string;
  logoPath?: string;
  requireNarration?: boolean;
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
  options: {
    root: string;
    shell: ShellProvider;
    renderTimeoutMs?: number;
    voiceModel?: string;
    voices?: readonly string[];
    credentialsPath?: string;
    synthesizeVoice?: VoiceSynthesizer;
    creatorName?: string;
    logoPath?: string;
  },
): () => void {
  const root = resolve(options.root);
  const voices = options.voices ?? DEFAULT_VOICES;
  const shellPolicy = unrestrictedPolicy(root);
  const disposers = [
    registry.register({
      name: "video_analyze_source",
      description: "扫描当前工作区的完整开源项目，默认包含 README、manifest、源码和测试，并排除 videos/tmp/依赖与构建目录；返回项目身份、GitHub 归属、Logo 候选和有界源码证据。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "可选；默认分析当前工作区全部内容（.）" },
          exclude: { type: "array", items: { type: "string" }, description: "额外排除的目录名，默认已排除 videos、tmp、依赖和构建目录" },
        },
        required: [],
        additionalProperties: false,
      },
      executionMode: { kind: "parallel" },
      async execute(args, context) {
        const path = resolveInside(root, optionalString(args, "path") ?? ".");
        const exclude = optionalStringArray(args, "exclude", 20);
        return JSON.stringify(await analyzeSource(path, context.signal, exclude), null, 2);
      },
    }),
    registry.register({
      name: "video_create_hyperframes",
      description: "根据结构化视频方案创建可预览、检查和渲染的 1080x1920 Hyperframes 工程。旁白音频必须是本地文件；本工具不会联网生成配音。",
      parameters: {
        type: "object",
        properties: {
          outputDir: { type: "string", description: "工作区内的输出根目录，例如 videos；插件自动创建 <outputDir>/<plan.slug> 工程目录" },
          plan: { type: "object", description: "当前开源仓库的宣传视频方案：slug、projectName、projectIdentity、sourcePath、搜索与收藏字段、scenes。用项目价值、核心能力、差异点、实现证据、适用人群和 GitHub 行动引导组织内容。技术事实的 evidence 必须含 file/lineStart/lineEnd/claim/kind。作者和 GitHub 地址由插件自动注入，Logo 从当前项目自动发现或由 logoPath 指定；禁止二维码。" },
        },
        required: ["outputDir", "plan"],
        additionalProperties: false,
      },
      executionMode: { kind: "exclusive" },
      async execute(args, context) {
        const outputRoot = resolveInside(root, requiredString(args, "outputDir"));
        const rawPlan = objectField(args, "plan");
        rejectQrPromotion(rawPlan);
        const plan = await applyProjectBranding(root, parsePlan(rawPlan), {
          creatorName: options.creatorName ?? "虾哥不加班",
          logoPath: options.logoPath,
        });
        const output = resolveInside(outputRoot, plan.slug);
        const result = await createHyperframesProject(root, output, plan, context.signal);
        return JSON.stringify(result, null, 2);
      },
    }),
    registry.register({
      name: "video_generate_voice",
      description: "使用 CosyVoice 为 Hyperframes 工程逐场景生成旁白，按真实音频时长重写视频时间轴。旁白会发送到阿里云百炼，无需审批；API Key 只读取 DASHSCOPE_API_KEY。",
      parameters: {
        type: "object",
        properties: {
          projectDir: { type: "string", description: "video_create_hyperframes 创建的工作区内项目目录" },
          voice: { type: "string", description: `可选音色：${voices.join("、")}；省略时首次随机、后续沿用` },
        },
        required: ["projectDir"],
        additionalProperties: false,
      },
      executionMode: { kind: "exclusive" },
      timeoutMs: 900_000,
      async execute(args, context) {
        const project = resolveInside(root, requiredString(args, "projectDir"));
        const requestedVoice = optionalString(args, "voice");
        const result = await generateVoice(project, {
          shell: options.shell,
          signal: context.signal,
          voices,
          model: options.voiceModel ?? "cosyvoice-v3-flash",
          sandboxPolicy: shellPolicy,
          ...(requestedVoice === undefined ? {} : { voice: requestedVoice }),
          synthesize: options.synthesizeVoice ?? dashscopeSynthesizer(options.credentialsPath),
        });
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
        if (plan.requireNarration && plan.scenes.some((scene) => scene.audioPath === undefined)) {
          throw new ToolError("视频要求有声交付，但仍有场景缺少旁白音频", "VIDEO_AUDIO_INCOMPLETE");
        }
        const output = join(project, "renders", `${plan.slug}.mp4`);
        const npmCache = join(project, ".npm-cache");
        const tmpDir = join(project, ".hyperframes-tmp");
        await mkdir(npmCache, { recursive: true });
        await mkdir(tmpDir, { recursive: true });
        const envPrefix = `NPM_CONFIG_CACHE=${shellQuote(npmCache)} TMPDIR=${shellQuote(tmpDir)}`;
        const result = await options.shell.run({
          command: `${envPrefix} npm run check && ${envPrefix} npm run render`,
          cwd: project,
          signal: context.signal,
          timeoutMs: options.renderTimeoutMs ?? 1_800_000,
          maxBytes: 24_000,
          sandboxPolicy: shellPolicy,
        });
        if (result.exitCode !== 0 || result.timedOut || result.aborted) {
          throw new ToolError(`Hyperframes 渲染失败：${tail(result.stderr || result.stdout)}`, result.timedOut ? "VIDEO_RENDER_TIMEOUT" : "VIDEO_RENDER_FAILED");
        }
        const info = await stat(output).catch(() => undefined);
        if (info === undefined || !info.isFile() || info.size === 0) {
          throw new ToolError(`Hyperframes 命令成功，但未生成 ${relative(root, output)}`, "VIDEO_OUTPUT_MISSING");
        }
        return JSON.stringify({
          status: "completed",
          mp4: output,
          bytes: info.size,
          audioScenes: plan.scenes.filter((scene) => scene.audioPath !== undefined).length,
          totalScenes: plan.scenes.length,
          repositoryUrl: plan.repositoryUrl,
          creatorName: plan.creatorName,
          log: tail(result.stdout),
        }, null, 2);
      },
    }),
  ];
  return () => { disposers.reverse().forEach((dispose) => dispose()); };
}

export async function analyzeSource(path: string, signal: AbortSignal, exclude: readonly string[] = []) {
  const rootStat = await stat(path).catch(() => undefined);
  if (!rootStat?.isDirectory()) throw new ToolError("源码路径不是目录", "VIDEO_SOURCE_NOT_DIRECTORY");
  const files: string[] = [];
  const languages = new Map<string, number>();
  const evidence: { file: string; excerpt: string }[] = [];
  const manifests: { file: string; excerpt: string }[] = [];
  const ignored = new Set([...IGNORED_DIRECTORIES, ...exclude]);
  async function walk(current: string, depth: number): Promise<void> {
    signal.throwIfAborted();
    if (files.length >= MAX_FILES || depth > 8) return;
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name) && !entry.name.startsWith(".")) await walk(join(current, entry.name), depth + 1);
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
  const metadata = await readProjectMetadata(path);
  return {
    project: metadata.name ?? basename(path),
    sourcePath: path,
    scannedFiles: files.length,
    truncated: files.length >= MAX_FILES,
    languages: [...languages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => ({ name, count })),
    tree: files.slice(0, 160),
    manifests,
    projectIdentity: metadata.description,
    repositoryUrl: metadata.repositoryUrl,
    creatorName: "虾哥不加班",
    logoCandidates: await findLogoCandidates(path),
    excludedDirectories: [...ignored].sort(),
    evidence,
    instruction: "目标是宣传当前开源仓库，让观众理解它解决什么问题、为什么值得使用，并去 GitHub 查看。先确认项目身份与仓库归属，再选择最能体现项目价值的叙事主线；可以讲核心能力、效果、使用场景或关键机制，不强制包装成单一问题。源码证据用于支撑卖点，禁止夸大。第一帧显示项目名、作者和 GitHub 仓库，结尾明确引导访问 GitHub；禁止二维码。",
  };
}

export async function createHyperframesProject(root: string, output: string, plan: HyperframesPlan, signal: AbortSignal) {
  rejectQrPromotion(plan);
  const checks = contentChecks(plan);
  const failedChecks = hardCheckFailures(checks);
  if (failedChecks.length > 0) {
    return {
      status: "needs_revision",
      failedChecks,
      contentChecks: checks,
      next: "补齐当前项目身份、GitHub 归属、源码证据或画面类型后重新创建。",
    };
  }
  const sourceRoot = resolveInside(root, plan.sourcePath!);
  const hydratedScenes = await hydrateEvidence(sourceRoot, plan.scenes, signal);
  const logoSource = plan.logoPath === undefined ? undefined : resolveInside(root, plan.logoPath);
  const logoInfo = logoSource === undefined ? undefined : await stat(logoSource).catch(() => undefined);
  if (logoSource !== undefined && !logoInfo?.isFile()) throw new ToolError(`项目 Logo 不存在：${plan.logoPath}`, "VIDEO_BRAND_LOGO_MISSING");
  await mkdir(join(output, "compositions", "frames"), { recursive: true });
  await mkdir(join(output, "assets", "voice"), { recursive: true });
  await mkdir(join(output, "assets", "brand"), { recursive: true });
  await mkdir(join(output, "renders"), { recursive: true });
  await copyVisualAssets(output);
  const normalizedLogoPath = logoSource === undefined ? undefined : `assets/brand/project-logo${extname(logoSource) || ".png"}`;
  if (logoSource !== undefined && normalizedLogoPath !== undefined) await copyFile(logoSource, join(output, normalizedLogoPath));
  const normalizedScenes: VideoScene[] = [];
  for (let index = 0; index < hydratedScenes.length; index += 1) {
    signal.throwIfAborted();
    const scene = hydratedScenes[index]!;
    let audio: string | undefined;
    if (scene.audioPath !== undefined) {
      const source = resolveInside(root, scene.audioPath);
      audio = `assets/voice/${String(index + 1).padStart(2, "0")}${extname(source) || ".mp3"}`;
      await copyFile(source, join(output, audio));
    }
    normalizedScenes.push({ ...scene, ...(audio === undefined ? {} : { audioPath: audio }) });
  }
  const normalized = {
    ...plan,
    ...(normalizedLogoPath === undefined ? {} : { logoPath: normalizedLogoPath }),
    scenes: normalizedScenes,
  };
  await Promise.all([
    writeFile(join(output, "video-plan.json"), `${JSON.stringify(normalized, null, 2)}\n`),
    writeFile(join(output, "hyperframes.json"), `${JSON.stringify(hyperframesConfig(), null, 2)}\n`),
    writeFile(join(output, "package.json"), `${JSON.stringify(packageConfig(plan.slug), null, 2)}\n`),
    writeFile(join(output, ".gitignore"), "node_modules/\nrenders/\n.hyperframes/\n.npm-cache/\n.hyperframes-tmp/\n"),
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

export async function generateVoice(project: string, options: {
  shell: ShellProvider;
  signal: AbortSignal;
  voices: readonly string[];
  model: string;
  voice?: string;
  synthesize: VoiceSynthesizer;
  sandboxPolicy?: SandboxExecutionPolicy;
}) {
  if (options.voices.length === 0) throw new ToolError("插件未配置可用音色", "VIDEO_VOICE_CONFIG_INVALID");
  const planPath = join(project, "video-plan.json");
  const plan = parsePlan(JSON.parse(await readFile(planPath, "utf8")));
  const previous = await readVoiceMeta(join(project, "audio-meta.json"));
  const voice = options.voice ?? previous?.voice ?? options.voices[Math.floor(Math.random() * options.voices.length)]!;
  if (!options.voices.includes(voice)) {
    throw new ToolError(`不支持音色 ${voice}；可选：${options.voices.join("、")}`, "VIDEO_VOICE_UNSUPPORTED");
  }
  const voiceDir = join(project, "assets", "voice");
  await mkdir(voiceDir, { recursive: true });
  const scenes: VideoScene[] = [];
  const metaScenes: { id: string; path: string; duration: number; characters: number }[] = [];
  for (let index = 0; index < plan.scenes.length; index += 1) {
    options.signal.throwIfAborted();
    const scene = plan.scenes[index]!;
    const filename = `${String(index + 1).padStart(2, "0")}.mp3`;
    const relativeAudio = `assets/voice/${filename}`;
    const absoluteAudio = join(voiceDir, filename);
    const bytes = await options.synthesize({
      text: normalizeNarration(scene.narration),
      voice,
      model: options.model,
      signal: options.signal,
    });
    if (bytes.byteLength === 0) throw new ToolError(`场景 ${scene.id} 返回空音频`, "VIDEO_VOICE_EMPTY");
    await writeFile(absoluteAudio, bytes);
    const duration = Math.max(3, Number(((await probeDuration(options.shell, project, relativeAudio, options.signal, options.sandboxPolicy)) + 0.35).toFixed(3)));
    if (duration > 120) throw new ToolError(`场景 ${scene.id} 旁白超过 120 秒，请拆分场景`, "VIDEO_VOICE_TOO_LONG");
    scenes.push({ ...scene, duration, audioPath: relativeAudio });
    metaScenes.push({ id: scene.id, path: relativeAudio, duration, characters: scene.narration.length });
  }
  const measuredTotal = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  if (measuredTotal > 1_200) throw new ToolError("旁白总时长超过 20 分钟，请精简或拆分视频", "VIDEO_VOICE_TOO_LONG");
  if (measuredTotal < 30) {
    const last = scenes.at(-1)!;
    const padded = Number((last.duration + 30 - measuredTotal).toFixed(3));
    scenes[scenes.length - 1] = { ...last, duration: padded };
    metaScenes[metaScenes.length - 1] = { ...metaScenes.at(-1)!, duration: padded };
  }
  const updated = { ...plan, scenes };
  await Promise.all([
    writeFile(planPath, `${JSON.stringify(updated, null, 2)}\n`),
    writeFile(join(project, "audio-meta.json"), `${JSON.stringify({ provider: "cosyvoice", model: options.model, voice, scenes: metaScenes }, null, 2)}\n`),
    writeFile(join(project, "index.html"), renderIndex(updated)),
    writeFile(join(project, "compositions", "captions.html"), renderCaptions(updated)),
    ...scenes.map((scene, index) => writeFile(join(project, "compositions", "frames", `${scene.id}.html`), renderFrame(updated, scene, index))),
  ]);
  return {
    status: "completed",
    provider: "cosyvoice",
    model: options.model,
    voice,
    scenes: scenes.length,
    duration: Number(scenes.reduce((sum, scene) => sum + scene.duration, 0).toFixed(3)),
    audioMeta: join(project, "audio-meta.json"),
    next: "调用 video_render_hyperframes 生成有声 MP4。",
  };
}

function dashscopeSynthesizer(credentialsPath?: string, fetcher: typeof fetch = fetch): VoiceSynthesizer {
  return async ({ text, voice, model, signal }) => {
    const apiKey = await readDashscopeApiKey(credentialsPath) ?? process.env.DASHSCOPE_API_KEY?.trim();
    if (!apiKey) throw new ToolError("缺少 credentials.json.dashscopeApiKey 或环境变量 DASHSCOPE_API_KEY", "VIDEO_VOICE_CREDENTIAL_MISSING");
    const response = await fetcher(DASHSCOPE_TTS_URL, {
      method: "POST",
      signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: { text, voice, format: "mp3", sample_rate: 24_000 } }),
    });
    const payload = await response.json().catch(() => undefined) as unknown;
    if (!response.ok || !isObject(payload)) {
      throw new ToolError(`CosyVoice 请求失败（HTTP ${response.status}）`, "VIDEO_VOICE_REQUEST_FAILED");
    }
    const audioUrl = nestedString(payload, ["output", "audio", "url"]);
    if (audioUrl === undefined) {
      const code = typeof payload.code === "string" ? payload.code : "unknown";
      throw new ToolError(`CosyVoice 未返回音频地址（${code}）`, "VIDEO_VOICE_REQUEST_FAILED");
    }
    const audio = await fetcher(audioUrl, { signal });
    if (!audio.ok) throw new ToolError(`下载旁白失败（HTTP ${audio.status}）`, "VIDEO_VOICE_DOWNLOAD_FAILED");
    return new Uint8Array(await audio.arrayBuffer());
  };
}

async function readDashscopeApiKey(path: string | undefined): Promise<string | undefined> {
  if (path === undefined) return undefined;
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isObject(value) || value.version !== 1) throw new Error("invalid credentials");
    const key = value.dashscopeApiKey;
    if (key === undefined) return undefined;
    if (typeof key !== "string" || key.trim().length === 0 || /[\r\n]/u.test(key)) throw new Error("invalid dashscope key");
    return key.trim();
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw new ToolError("credentials.json 中的 dashscopeApiKey 无效", "VIDEO_VOICE_CREDENTIAL_INVALID", { cause: error });
  }
}

async function probeDuration(
  shell: ShellProvider,
  project: string,
  path: string,
  signal: AbortSignal,
  sandboxPolicy?: SandboxExecutionPolicy,
): Promise<number> {
  const result = await shell.run({
    command: `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${path}`,
    cwd: project,
    signal,
    timeoutMs: 30_000,
    maxBytes: 2_000,
    ...(sandboxPolicy === undefined ? {} : { sandboxPolicy }),
  });
  const duration = Number(result.stdout.trim());
  if (result.exitCode !== 0 || !Number.isFinite(duration) || duration <= 0) {
    throw new ToolError(`无法读取 ${path} 时长：${tail(result.stderr || result.stdout)}`, "VIDEO_VOICE_DURATION_FAILED");
  }
  return Number(duration.toFixed(3));
}

async function readVoiceMeta(path: string): Promise<{ voice?: string } | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    return isObject(value) && typeof value.voice === "string" ? { voice: value.voice } : undefined;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw new ToolError("audio-meta.json 格式无效", "VIDEO_VOICE_META_INVALID", { cause: error });
  }
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
    const evidence = raw.evidence === undefined ? undefined : evidenceArray(raw.evidence, `scene ${id}.evidence`);
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
      ...(evidence === undefined ? {} : { evidence }),
      ...(raw.sourceLabel === undefined ? {} : { sourceLabel: stringValue(raw.sourceLabel, `scene ${id}.sourceLabel`) }),
      ...(raw.sourceExcerpt === undefined ? {} : { sourceExcerpt: stringValue(raw.sourceExcerpt, `scene ${id}.sourceExcerpt`) }),
    };
  });
  const totalDuration = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  if (totalDuration < 30 || totalDuration > 1_200) throw new ToolError("视频总时长必须是 30～1200 秒", "VIDEO_PLAN_INVALID");
  return {
    slug,
    projectName,
    scenes,
    ...(value.projectIdentity === undefined ? {} : { projectIdentity: stringValue(value.projectIdentity, "plan.projectIdentity") }),
    ...(value.sourcePath === undefined ? {} : { sourcePath: stringValue(value.sourcePath, "plan.sourcePath") }),
    ...(value.creatorName === undefined ? {} : { creatorName: stringValue(value.creatorName, "plan.creatorName") }),
    ...(value.repositoryUrl === undefined ? {} : { repositoryUrl: repositoryUrlValue(value.repositoryUrl, "plan.repositoryUrl") }),
    ...(value.logoPath === undefined ? {} : { logoPath: stringValue(value.logoPath, "plan.logoPath") }),
    requireNarration: value.requireNarration === undefined ? true : booleanValue(value.requireNarration, "plan.requireNarration"),
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

async function copyVisualAssets(output: string): Promise<void> {
  const pack = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "hyperframes");
  await mkdir(join(output, "assets", "fonts"), { recursive: true });
  await mkdir(join(output, "assets", "vendor"), { recursive: true });
  for (const font of ["Georgia.ttf", "Georgia-Bold.ttf", "Consola.ttf"]) {
    const source = join(pack, "fonts", font);
    if ((await stat(source).catch(() => undefined))?.isFile()) await copyFile(source, join(output, "assets", "fonts", font));
  }
  const gsap = join(pack, "vendor", "gsap.min.js");
  if ((await stat(gsap).catch(() => undefined))?.isFile()) await copyFile(gsap, join(output, "assets", "vendor", "gsap.min.js"));
}

function renderIndex(plan: HyperframesPlan): string {
  let cursor = 0;
  const tracks = plan.scenes.map((scene, index) => {
    const start = cursor; cursor += scene.duration;
    const audioId = String(index + 1).padStart(2, "0");
    const audio = scene.audioPath === undefined ? "" : `\n      <audio id="audio-${audioId}" src="${escapeHtml(scene.audioPath)}" data-start="${start.toFixed(3)}" data-duration="${scene.duration.toFixed(3)}" data-track-index="10"></audio>`;
    return `      <div class="scene" data-composition-id="${escapeHtml(scene.id)}" data-composition-src="compositions/frames/${escapeHtml(scene.id)}.html" data-start="${start.toFixed(3)}" data-duration="${scene.duration.toFixed(3)}" data-track-index="${index % 2}"></div>${audio}`;
  }).join("\n");
  return `<!doctype html>\n<html><head><meta charset="UTF-8"><meta name="viewport" content="width=1080,height=1920"><style>*{box-sizing:border-box}html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:#000}.scene{position:absolute;inset:0}</style></head><body><div id="root" data-composition-id="main" data-no-timeline data-start="0" data-duration="${cursor.toFixed(3)}" data-width="1080" data-height="1920">\n${tracks}\n      <div class="scene" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="${cursor.toFixed(3)}" data-track-index="20"></div>\n    </div></body></html>\n`;
}

function renderPublishCopy(plan: HyperframesPlan): string {
  const title = plan.searchableTitle ?? plan.scenes[0]?.title ?? plan.projectName;
  const keywords = plan.searchKeywords ?? [];
  const saveValue = plan.saveValue ?? [];
  return `# 发布文案\n\n## 标题\n\n${title}\n\n## 描述\n\n${plan.audienceQuestion ?? title}\n\n这是「${plan.creatorName ?? "虾哥不加班"}」公开研发的 ${plan.projectName}，源码已发布到 GitHub：${plan.repositoryUrl ?? ""}\n\n${saveValue.length > 0 ? `这条视频讲清：${saveValue.join("、")}。建议收藏，遇到类似问题时可以按步骤排查。` : ""}\n\n${keywords.map((keyword) => `#${keyword.replace(/\s+/gu, "")}`).join(" ")}\n\n## 置顶评论\n\n项目源码：${plan.repositoryUrl ?? ""}\n关注「${plan.creatorName ?? "虾哥不加班"}」，持续公开 AI Agent 研发与源码拆解。${plan.seriesNext ? `下一期：${plan.seriesNext}。` : ""}\n\n## 发布检查\n\n- 第一帧清楚显示项目名、虾哥公开研发和 GitHub 仓库。\n- 全片只使用项目自带 Logo，不出现二维码或扫码引导。\n- 标题、口播、字幕自然包含核心搜索词，不堆砌关键词。\n`;
}

function contentChecks(plan: HyperframesPlan) {
  const firstSceneText = `${plan.scenes[0]?.title ?? ""} ${plan.scenes[0]?.narration ?? ""}`.toLowerCase();
  const evidenceFiles = new Set(plan.scenes.flatMap((scene) => scene.evidence ?? []).map((item) => item.file));
  const technicalScenes = plan.scenes.filter((scene) => scene.template !== "hook" && scene !== plan.scenes.at(-1));
  const evidencedTechnicalScenes = technicalScenes.filter((scene) => (scene.evidence?.length ?? 0) > 0);
  return {
    searchableQuestion: Boolean(plan.audienceQuestion && plan.searchableTitle),
    keywords: (plan.searchKeywords?.length ?? 0) >= 2,
    saveValue: (plan.saveValue?.length ?? 0) >= 2,
    seriesContinuation: Boolean(plan.seriesNext),
    projectIdentity: Boolean(plan.projectIdentity && plan.projectIdentity.length >= 12),
    projectVisibility: firstSceneText.includes(plan.projectName.toLowerCase()),
    repositoryVisible: /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/u.test(plan.repositoryUrl ?? ""),
    creatorVisible: plan.creatorName === "虾哥不加班",
    brandLogoPresent: plan.logoPath !== undefined,
    qrCodeAbsent: !containsQrPromotion(plan),
    evidenceFiles: evidenceFiles.size,
    evidenceCoverage: technicalScenes.length === 0 ? 1 : Number((evidencedTechnicalScenes.length / technicalScenes.length).toFixed(2)),
    visualVariety: new Set(plan.scenes.map((scene, index) => resolveVisualTemplate(scene, index, plan.scenes.length))).size >= 3,
    narrationComplete: !plan.requireNarration || plan.scenes.every((scene) => scene.audioPath !== undefined),
    aiDisclosure: plan.aiDisclosure !== false,
    durationMode: plan.scenes.reduce((sum, scene) => sum + scene.duration, 0) > 180 ? "deep-dive" : "compact",
  };
}

function hyperframesConfig() { return { $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry", paths: { blocks: "compositions", components: "compositions/components", assets: "assets" }, media: { autoProxy: true }, skill: "faceless-explainer", authoringSkill: "faceless-explainer" }; }
function packageConfig(slug: string) { return { name: slug, private: true, type: "module", scripts: { dev: `npx --yes hyperframes@${HYPERFRAMES_VERSION} preview`, check: `npx --yes hyperframes@${HYPERFRAMES_VERSION} check`, render: `npx --yes hyperframes@${HYPERFRAMES_VERSION} render --output renders/${slug}.mp4` } }; }

async function applyProjectBranding(
  root: string,
  plan: HyperframesPlan,
  branding: { creatorName: string; logoPath?: string },
): Promise<HyperframesPlan> {
  const metadata = await readProjectMetadata(root);
  if (metadata.repositoryUrl === undefined) {
    throw new ToolError("无法从 package.json 或 Git remote 确认 GitHub 仓库地址", "VIDEO_REPOSITORY_UNKNOWN");
  }
  const discoveredLogo = (await findLogoCandidates(root))[0];
  const logoPath = plan.logoPath ?? (branding.logoPath?.trim() || undefined) ?? discoveredLogo;
  return {
    ...plan,
    sourcePath: plan.sourcePath ?? ".",
    creatorName: branding.creatorName,
    repositoryUrl: metadata.repositoryUrl,
    ...(logoPath === undefined ? {} : { logoPath }),
  };
}

async function findLogoCandidates(root: string): Promise<string[]> {
  const candidates: string[] = [];
  async function walk(current: string, depth: number): Promise<void> {
    if (depth > 3 || candidates.length >= 20) return;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) await walk(join(current, entry.name), depth + 1);
        continue;
      }
      if (!entry.isFile() || !/\.(?:png|jpe?g|svg|webp)$/iu.test(entry.name)) continue;
      const rel = relative(root, join(current, entry.name));
      if (/(?:^|[-_.])(logo|icon|brand)(?:[-_.]|$)/iu.test(entry.name) || /(?:^|\/)(?:logo|icons?|branding)(?:\/|$)/iu.test(rel)) candidates.push(rel);
    }
  }
  await walk(root, 0);
  return candidates.sort((a, b) => logoScore(b) - logoScore(a) || a.localeCompare(b));
}

function logoScore(path: string): number {
  const name = basename(path).toLowerCase();
  if (name === "logo.png" || name === "logo.svg") return 100;
  if (name.includes("logo")) return 80;
  if (name.includes("icon")) return 50;
  return 10;
}

async function readProjectMetadata(path: string): Promise<{ name?: string; description?: string; repositoryUrl?: string }> {
  let packageValue: Record<string, unknown> | undefined;
  try {
    const value = JSON.parse(await readFile(join(path, "package.json"), "utf8")) as unknown;
    if (isObject(value)) packageValue = value;
  } catch {
    packageValue = undefined;
  }
  const packageRepository = packageValue?.repository;
  const packageRepositoryUrl = typeof packageRepository === "string"
    ? packageRepository
    : isObject(packageRepository) && typeof packageRepository.url === "string" ? packageRepository.url : undefined;
  let gitRemote: string | undefined;
  try {
    const config = await readFile(join(path, ".git", "config"), "utf8");
    const origin = config.match(/\[remote\s+"origin"\][\s\S]*?\n\s*url\s*=\s*([^\r\n]+)/u)?.[1]?.trim();
    gitRemote = origin;
  } catch {
    gitRemote = undefined;
  }
  const repositoryUrl = normalizeRepositoryUrl(packageRepositoryUrl) ?? normalizeRepositoryUrl(gitRemote);
  return {
    ...(typeof packageValue?.name === "string" ? { name: packageValue.name } : {}),
    ...(typeof packageValue?.description === "string" ? { description: packageValue.description } : {}),
    ...(repositoryUrl === undefined ? {} : { repositoryUrl }),
  };
}

function normalizeRepositoryUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim()
    .replace(/^git\+https:\/\//u, "https://")
    .replace(/^git@github\.com:/u, "https://github.com/")
    .replace(/\.git$/u, "");
  return /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/u.test(normalized) ? normalized.replace(/\/$/u, "") : undefined;
}

async function hydrateEvidence(sourceRoot: string, scenes: readonly VideoScene[], signal: AbortSignal): Promise<VideoScene[]> {
  return Promise.all(scenes.map(async (scene) => {
    signal.throwIfAborted();
    const first = scene.evidence?.[0];
    if (first === undefined) return { ...scene, sourceLabel: undefined, sourceExcerpt: undefined };
    const path = resolveInside(sourceRoot, first.file);
    const info = await stat(path).catch(() => undefined);
    if (!info?.isFile()) throw new ToolError(`源码证据文件不存在：${first.file}`, "VIDEO_EVIDENCE_INVALID");
    const lines = (await readFile(path, "utf8")).split(/\r?\n/u);
    if (first.lineEnd > lines.length) {
      throw new ToolError(`源码证据行号越界：${first.file}:${first.lineStart}-${first.lineEnd}`, "VIDEO_EVIDENCE_INVALID");
    }
    const excerpt = lines.slice(first.lineStart - 1, first.lineEnd).join("\n");
    return {
      ...scene,
      sourceLabel: `${first.file} · L${first.lineStart}–${first.lineEnd}`,
      sourceExcerpt: excerpt.length > 1_600 ? `${excerpt.slice(0, 1_600)}…` : excerpt,
    };
  }));
}

function evidenceArray(value: unknown, label: string): SourceEvidence[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new ToolError(`${label} 必须是 1～8 条源码证据`, "VIDEO_PLAN_INVALID");
  }
  return value.map((raw, index) => {
    if (!isObject(raw)) throw new ToolError(`${label}[${index}] 必须是对象`, "VIDEO_PLAN_INVALID");
    const lineStart = Number(raw.lineStart);
    const lineEnd = Number(raw.lineEnd);
    if (!Number.isSafeInteger(lineStart) || !Number.isSafeInteger(lineEnd) || lineStart < 1 || lineEnd < lineStart || lineEnd - lineStart > 40) {
      throw new ToolError(`${label}[${index}] 行号无效或超过 40 行`, "VIDEO_PLAN_INVALID");
    }
    const kind = stringValue(raw.kind, `${label}[${index}].kind`) as SourceEvidence["kind"];
    if (!["fact", "boundary", "hypothetical"].includes(kind)) throw new ToolError(`${label}[${index}].kind 无效`, "VIDEO_PLAN_INVALID");
    return {
      file: stringValue(raw.file, `${label}[${index}].file`),
      lineStart,
      lineEnd,
      claim: stringValue(raw.claim, `${label}[${index}].claim`),
      kind,
    };
  });
}

function hardCheckFailures(checks: ReturnType<typeof contentChecks>): string[] {
  const required: Array<keyof typeof checks> = [
    "keywords", "saveValue", "projectIdentity", "projectVisibility", "repositoryVisible",
    "creatorVisible", "qrCodeAbsent", "visualVariety",
  ];
  const failed = required.filter((key) => checks[key] !== true).map(String);
  if (checks.evidenceFiles < 2) failed.push("evidenceFiles");
  if (checks.evidenceCoverage < 0.5) failed.push("evidenceCoverage");
  return failed;
}

function rejectQrPromotion(value: unknown): void {
  if (containsQrPromotion(value)) throw new ToolError("视频禁止二维码、扫码引导和 QR 相关字段", "VIDEO_QR_FORBIDDEN");
}

function containsQrPromotion(value: unknown): boolean {
  return /二维码|扫码|\bqr(?:code)?\b/iu.test(JSON.stringify(value));
}

function repositoryUrlValue(value: unknown, label: string): string {
  const url = normalizeRepositoryUrl(stringValue(value, label));
  if (url === undefined) throw new ToolError(`${label} 必须是有效 GitHub 仓库地址`, "VIDEO_PLAN_INVALID");
  return url;
}

function repositoryLabel(url: string): string {
  return url.replace(/^https:\/\/github\.com\//u, "").replace(/\/$/u, "");
}

function optionalStringArray(args: unknown, key: string, max: number): string[] {
  if (!isObject(args) || args[key] === undefined) return [];
  return stringArray(args[key], key, max);
}

function unrestrictedPolicy(workspaceRoot: string): SandboxExecutionPolicy {
  return { mode: "danger-full-access", workspaceRoot };
}
function shellQuote(value: string): string { return `'${value.replaceAll("'", `'\\''`)}'`; }
function resolveInside(root: string, input: string) { const target = resolve(root, input); if (target !== root && !target.startsWith(`${root}${sep}`)) throw new ToolError("路径必须位于当前工作区", "VIDEO_PATH_OUTSIDE_WORKSPACE"); return target; }
function requiredString(args: unknown, key: string) { return stringValue(isObject(args) ? args[key] : undefined, key); }
function optionalString(args: unknown, key: string) { const value = isObject(args) ? args[key] : undefined; return value === undefined ? undefined : stringValue(value, key); }
function objectField(args: unknown, key: string) { if (!isObject(args) || !isObject(args[key])) throw new ToolError(`${key} 必须是对象`, "VIDEO_ARGUMENT_INVALID"); return args[key]; }
function stringValue(value: unknown, label: string) { if (typeof value !== "string" || value.trim().length === 0) throw new ToolError(`${label} 必须是非空字符串`, "VIDEO_ARGUMENT_INVALID"); return value.trim(); }
function stringArray(value: unknown, label: string, max: number) { if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== "string" || item.trim().length === 0)) throw new ToolError(`${label} 必须是最多 ${max} 个非空字符串`, "VIDEO_PLAN_INVALID"); return value.map((item) => String(item).trim()); }
function colorValue(value: unknown, label: string) { const color = stringValue(value, label); if (!/^#[0-9a-f]{6}$/iu.test(color)) throw new ToolError(`${label} 必须是六位十六进制颜色`, "VIDEO_PLAN_INVALID"); return color; }
function booleanValue(value: unknown, label: string) { if (typeof value !== "boolean") throw new ToolError(`${label} 必须是布尔值`, "VIDEO_PLAN_INVALID"); return value; }
function normalizeNarration(text: string) { return text.replace(/_/gu, " ").replace(/\s+/gu, " ").trim(); }
function nestedString(value: Record<string, unknown>, path: readonly string[]): string | undefined { let current: unknown = value; for (const key of path) { if (!isObject(current)) return undefined; current = current[key]; } return typeof current === "string" && current.length > 0 ? current : undefined; }
function isNodeError(error: unknown, code: string) { return isObject(error) && error.code === code; }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function compact(text: string, max: number) { return text.replace(/\s+/gu, " ").trim().slice(0, max); }
function escapeHtml(text: string) { return text.replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!); }
function tail(text: string) { return text.trim().split("\n").slice(-16).join("\n").slice(-4_000); }
