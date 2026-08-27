import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { ToolError, type ToolRegistry } from "./tools.ts";
import { renderArticleVisuals, type VisualPng } from "./wechat-article-visuals.ts";

type Item = { title: string; text: string };
type ArticlePlan = {
  title: string;
  subtitle: string;
  projectName: string;
  repositoryUrl: string;
  logoPath?: string;
  opening: string[];
  journey: Item[];
  mechanism: { title: string; steps: Item[] };
  comparison: { beforeTitle: string; before: string[]; afterTitle: string; after: string[] };
  sections: Array<{ title: string; paragraphs: string[]; takeaway?: string }>;
  quote: string;
  closing: { summary: string; question: string };
  publish: { titles: string[]; abstract: string; tags: string[]; shareCopy: string; coverPrompt: string };
  evidence: Array<{ claim: string; source: string }>;
};

export function installWechatArticle(registry: ToolRegistry, options: { root: string }): () => void {
  const root = resolve(options.root);
  return registry.register({
    name: "wechat_create_article",
    description: "把精简的结构化文章方案渲染成精致的公众号 HTML，并生成只含标题、摘要和封面提示词的发布文案.md。职业时间线、机制流程、前后对照会渲成 PNG，复制后按图片保留样式；模型不要自行编写 HTML/CSS/JS。",
    parameters: {
      type: "object",
      properties: {
        outputDir: { type: "string", description: "工作区内输出目录，固定建议 wechat" },
        plan: planSchema(),
      },
      required: ["outputDir", "plan"],
      additionalProperties: false,
    },
    executionMode: { kind: "exclusive" },
    async execute(args) {
      const input = record(args, "args");
      const output = resolveInside(root, stringField(input, "outputDir"));
      const plan = parsePlan(normalizePlan(objectField(input, "plan")));
      const logo = plan.logoPath === undefined ? undefined : await inlineImage(root, plan.logoPath);
      const visuals = renderArticleVisuals({ journey: plan.journey, steps: plan.mechanism.steps, comparison: plan.comparison });
      const html = renderArticle(plan, visuals, logo);
      await mkdir(output, { recursive: true });
      const file = resolve(output, "article.html");
      const publishFile = resolve(output, "发布文案.md");
      await Promise.all([
        writeFile(file, html, "utf8"),
        writeFile(publishFile, renderPublishCopy(plan), "utf8"),
        ...visuals.map((visual) => writeFile(resolve(output, visual.file), visual.png)),
      ]);
      return JSON.stringify({
        status: "created",
        html: file,
        publishCopy: publishFile,
        figures: visuals.map((visual) => join(output, visual.file)),
        bytes: Buffer.byteLength(html),
        journeyNodes: plan.journey.length,
        flowSteps: plan.mechanism.steps.length,
        visualModules: 4,
        evidenceCount: plan.evidence.length,
      }, null, 2);
    },
  });
}

function itemSchema(title: string, text: string) {
  return {
    type: "object" as const,
    properties: {
      title: { type: "string", description: title },
      text: { type: "string", description: text },
    },
    required: ["title", "text"],
  };
}

function planSchema() {
  return {
    type: "object" as const,
    description: "结构化文章。字段名必须用 title、sections[].title、closing.{summary,question}、publish.titles/abstract/shareCopy、evidence[].source。",
    properties: {
      title: { type: "string", description: "12～60 字" },
      subtitle: { type: "string", description: "20～160 字" },
      projectName: { type: "string", description: "2～60 字项目名" },
      repositoryUrl: { type: "string", description: "https 仓库地址" },
      logoPath: { type: "string", description: "可选，工作区内 Logo 路径" },
      opening: { type: "array", items: { type: "string" }, description: "2～3 段开篇，每段 50～260 字" },
      journey: { type: "array", items: itemSchema("2～32 字节点名", "8～180 字"), description: "3～5 个职业时间线节点" },
      mechanism: {
        type: "object",
        properties: {
          title: { type: "string", description: "4～40 字，字段名是 title" },
          steps: { type: "array", items: itemSchema("2～32 字步骤名", "8～180 字"), description: "3～6 步" },
        },
        required: ["title", "steps"],
      },
      comparison: {
        type: "object",
        properties: {
          beforeTitle: { type: "string", description: "2～30 字，字段名是 beforeTitle" },
          before: { type: "array", items: { type: "string" }, description: "2～4 点" },
          afterTitle: { type: "string", description: "2～30 字，字段名是 afterTitle" },
          after: { type: "array", items: { type: "string" }, description: "2～4 点" },
        },
        required: ["beforeTitle", "before", "afterTitle", "after"],
      },
      sections: {
        type: "array",
        description: "2～4 节；每节用 title，不要用 heading",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "3～36 字，字段名是 title" },
            paragraphs: { type: "array", items: { type: "string" }, description: "1～3 段" },
            takeaway: { type: "string", description: "可选，10～120 字" },
          },
          required: ["title", "paragraphs"],
        },
      },
      quote: { type: "string", description: "20～180 字金句" },
      closing: {
        type: "object",
        description: "必须是对象 { summary, question }，不要用字符串数组",
        properties: {
          summary: { type: "string", description: "30～260 字" },
          question: { type: "string", description: "10～140 字提问" },
        },
        required: ["summary", "question"],
      },
      publish: {
        type: "object",
        properties: {
          titles: { type: "array", items: { type: "string" }, description: "3～5 条备选标题；字段名是 titles，不要用 titleCandidates" },
          abstract: { type: "string", description: "20～120 字；字段名是 abstract，不要用 summary" },
          tags: { type: "array", items: { type: "string" }, description: "2～5 个标签" },
          shareCopy: { type: "string", description: "20～240 字朋友圈文案；字段名是 shareCopy，不要用 moments" },
          coverPrompt: { type: "string", description: "只写画面与构图，30～500 字；标题、作者、摘要由工具拼进发布文案" },
        },
        required: ["titles", "abstract", "tags", "shareCopy", "coverPrompt"],
      },
      evidence: {
        type: "array",
        description: "3～8 条；用 source，不要用 file",
        items: {
          type: "object",
          properties: {
            claim: { type: "string", description: "8～160 字" },
            source: { type: "string", description: "3～160 字路径，字段名是 source" },
          },
          required: ["claim", "source"],
        },
      },
    },
    required: ["title", "subtitle", "projectName", "repositoryUrl", "opening", "journey", "mechanism", "comparison", "sections", "quote", "closing", "publish", "evidence"],
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

function normalizePlan(raw: Record<string, unknown>): Record<string, unknown> {
  const mechanism = asRecord(raw.mechanism);
  const comparison = asRecord(raw.comparison);
  const publish = asRecord(raw.publish);
  const closing = Array.isArray(raw.closing)
    ? { summary: raw.closing[0], question: raw.closing[1] ?? "欢迎去 GitHub 跑一遍这个项目。" }
    : raw.closing;
  return {
    ...raw,
    mechanism: mechanism === undefined ? raw.mechanism : { title: "一次请求如何走完", ...mechanism },
    comparison: comparison === undefined ? raw.comparison : {
      beforeTitle: "常见做法",
      afterTitle: "这个项目",
      ...comparison,
    },
    sections: Array.isArray(raw.sections)
      ? raw.sections.map((entry) => {
        const row = asRecord(entry);
        return row === undefined ? entry : { ...row, title: row.title ?? row.heading };
      })
      : raw.sections,
    closing,
    publish: publish === undefined ? raw.publish : {
      ...publish,
      titles: publish.titles ?? publish.titleCandidates,
      abstract: publish.abstract ?? publish.summary,
      shareCopy: publish.shareCopy ?? publish.moments,
    },
    evidence: Array.isArray(raw.evidence)
      ? raw.evidence.map((entry) => {
        const row = asRecord(entry);
        return row === undefined ? entry : { ...row, source: row.source ?? row.file };
      })
      : raw.evidence,
  };
}

function parsePlan(raw: Record<string, unknown>): ArticlePlan {
  const errors: string[] = [];
  const take = <T>(run: () => T, fallback: T): T => {
    try { return run(); }
    catch (error) {
      if (error instanceof ToolError) {
        errors.push(error.message);
        return fallback;
      }
      throw error;
    }
  };
  const logoPath = raw.logoPath === undefined ? undefined : take(() => text(raw.logoPath, "logoPath", 1, 240), "");
  const plan: ArticlePlan = {
    title: take(() => text(raw.title, "title", 12, 60), "未命名文章标题占位"),
    subtitle: take(() => text(raw.subtitle, "subtitle", 20, 160), "副标题需要补充具体处境和选择。"),
    projectName: take(() => text(raw.projectName, "projectName", 2, 60), "项目"),
    repositoryUrl: take(() => httpUrl(raw.repositoryUrl), "https://github.com/example/repo"),
    ...(logoPath ? { logoPath } : {}),
    opening: take(() => strings(raw.opening, "opening", 2, 3, 50, 260), []),
    journey: take(() => items(raw.journey, "journey", 3, 5), []),
    mechanism: parseMechanism(raw.mechanism, take),
    comparison: parseComparison(raw.comparison, take),
    sections: parseSections(raw.sections, take),
    quote: take(() => text(raw.quote, "quote", 20, 180), "先把发生过的事实记清楚。"),
    closing: parseClosing(raw.closing, take),
    publish: parsePublish(raw.publish, take),
    evidence: parseEvidence(raw.evidence, take),
  };
  if (errors.length > 0) throw invalid(errors.join("；"));
  const articleChars = JSON.stringify({
    opening: plan.opening,
    journey: plan.journey,
    mechanism: plan.mechanism,
    comparison: plan.comparison,
    sections: plan.sections,
    quote: plan.quote,
    closing: plan.closing,
  }).length;
  if (articleChars < 1_200 || articleChars > 7_000) throw invalid(`正文内容必须保持精炼，结构化字符数应为 1200～7000，当前 ${articleChars}`);
  return plan;
}

type Take = <T>(run: () => T, fallback: T) => T;

function parseMechanism(value: unknown, take: Take): ArticlePlan["mechanism"] {
  const raw = take(() => record(value, "mechanism"), {});
  return {
    title: take(() => text(raw.title, "mechanism.title", 4, 40), "核心机制"),
    steps: take(() => items(raw.steps, "mechanism.steps", 3, 6), []),
  };
}

function parseComparison(value: unknown, take: Take): ArticlePlan["comparison"] {
  const raw = take(() => record(value, "comparison"), {});
  return {
    beforeTitle: take(() => text(raw.beforeTitle, "comparison.beforeTitle", 2, 30), "之前"),
    before: take(() => strings(raw.before, "comparison.before", 2, 4, 4, 80), []),
    afterTitle: take(() => text(raw.afterTitle, "comparison.afterTitle", 2, 30), "之后"),
    after: take(() => strings(raw.after, "comparison.after", 2, 4, 4, 80), []),
  };
}

function parseSections(value: unknown, take: Take): ArticlePlan["sections"] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) {
    take(() => { throw invalid("sections 必须是 2～4 节"); }, undefined);
    return [];
  }
  return value.map((entry, index) => {
    const raw = take(() => record(entry, `sections[${index}]`), {});
    return {
      title: take(() => text(raw.title, `sections[${index}].title`, 3, 36), "小节"),
      paragraphs: take(() => strings(raw.paragraphs, `sections[${index}].paragraphs`, 1, 3, 40, 420), []),
      ...(raw.takeaway === undefined ? {} : { takeaway: take(() => text(raw.takeaway, `sections[${index}].takeaway`, 10, 120), "") }),
    };
  });
}

function parseClosing(value: unknown, take: Take): ArticlePlan["closing"] {
  const raw = take(() => record(value, "closing"), {});
  return {
    summary: take(() => text(raw.summary, "closing.summary", 30, 260), "先把发生过的事实记清楚，再谈智能。"),
    question: take(() => text(raw.question, "closing.question", 10, 140), "欢迎去 GitHub 跑一遍这个项目。"),
  };
}

function parsePublish(value: unknown, take: Take): ArticlePlan["publish"] {
  const raw = take(() => record(value, "publish"), {});
  return {
    titles: take(() => strings(raw.titles, "publish.titles", 3, 5, 10, 70), []),
    abstract: take(() => text(raw.abstract, "publish.abstract", 20, 120), "摘要待补"),
    tags: take(() => strings(raw.tags, "publish.tags", 2, 5, 2, 24), []),
    shareCopy: take(() => text(raw.shareCopy, "publish.shareCopy", 20, 240), "分享文案待补"),
    coverPrompt: take(() => text(raw.coverPrompt, "publish.coverPrompt", 30, 500), "封面提示词待补"),
  };
}

function parseEvidence(value: unknown, take: Take): ArticlePlan["evidence"] {
  if (!Array.isArray(value) || value.length < 3 || value.length > 8) {
    take(() => { throw invalid("evidence 必须是 3～8 条"); }, undefined);
    return [];
  }
  return value.map((entry, index) => {
    const raw = take(() => record(entry, `evidence[${index}]`), {});
    return {
      claim: take(() => text(raw.claim, `evidence[${index}].claim`, 8, 160), "待补充证据"),
      source: take(() => text(raw.source, `evidence[${index}].source`, 3, 160), "src/unknown.ts"),
    };
  });
}

function mpBlock(inner: string, style: string): string {
  return `<section style="${style}">${inner}</section>`;
}

function mpFigure(visual: VisualPng, alt: string): string {
  return `<p style="margin:22px 0"><img src="${visual.dataUrl}" alt="${escapeHtml(alt)}" width="652" style="width:100%;max-width:100%;height:auto;display:block;border:0"/></p>`;
}

function renderTakeaway(text: string): string {
  return mpBlock(`<p style="margin:0;color:#7b331f;font-weight:650;line-height:1.7">${escapeHtml(text)}</p>`, "margin:22px 0;padding:14px 16px;background-color:#fff3ed;border-left:5px solid #f15b36");
}

function renderSection(section: ArticlePlan["sections"][number], h2: string, paragraph: string): string {
  const body = section.paragraphs.map((value) => `<p style="${paragraph}">${richText(value)}</p>`).join("");
  const takeaway = section.takeaway === undefined ? "" : renderTakeaway(section.takeaway);
  return `<h2 style="${h2}">${escapeHtml(section.title)}</h2>${body}${takeaway}`;
}

function renderArticle(plan: ArticlePlan, visuals: VisualPng[], logo?: string): string {
  const paper = "max-width:720px;margin:0 auto;background:#fffdf8;color:#222;padding:38px 34px 64px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;font-size:17px;line-height:1.9";
  const h2 = "margin:46px 0 18px;font-size:24px;line-height:1.4;color:#172033";
  const paragraph = "margin:0 0 18px;color:#30343b;letter-spacing:.02em";
  const logoHtml = logo === undefined ? "" : `<img src="${logo}" alt="${escapeHtml(plan.projectName)} Logo" style="width:58px;height:58px;object-fit:contain;border-radius:16px;background:#fff"/>`;
  const evidence = plan.evidence.map((item) => `<li style="margin:9px 0"><strong>${escapeHtml(item.claim)}</strong><br/><code style="font-size:12px;color:#697080">${escapeHtml(item.source)}</code></li>`).join("");
  const titles = plan.publish.titles.map((title) => `<li style="margin:8px 0">${escapeHtml(title)}</li>`).join("");
  const tags = plan.publish.tags.map((tag) => `<span style="display:inline-block;margin:3px;padding:5px 9px;border-radius:999px;background:#eef2f8;color:#294878">${escapeHtml(tag)}</span>`).join("");
  const copyScript = "const b=document.getElementById('copy'),a=document.getElementById('article');function done(t){const o=b.textContent;b.textContent=t;setTimeout(()=>b.textContent=o,1800)}function payload(){return '<section style=\"font-size:17px;line-height:1.9;color:#222;font-family:-apple-system,BlinkMacSystemFont,PingFang SC,Microsoft YaHei,sans-serif\">'+a.innerHTML+'</section>'}function fallback(){const s=getSelection(),r=document.createRange();r.selectNodeContents(a);s.removeAllRanges();s.addRange(r);const ok=document.execCommand('copy');s.removeAllRanges();return ok}b.onclick=async()=>{try{if(navigator.clipboard&&window.ClipboardItem){await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([payload()],{type:'text/html'}),'text/plain':new Blob([a.innerText],{type:'text/plain'})})]);done('已复制')}else done(fallback()?'已复制':'请手动复制')}catch{done(fallback()?'已复制':'复制失败')}}";
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(plan.title)}</title><style>*{box-sizing:border-box}body{margin:0;background:#e9edf3;color:#222}.shell{display:grid;grid-template-columns:minmax(0,780px) 320px;gap:24px;max-width:1160px;margin:28px auto;padding:0 18px}.assistant{position:sticky;top:72px;align-self:start;max-height:calc(100vh - 92px);overflow:auto;background:#fff;border-radius:18px;padding:20px;box-shadow:0 12px 35px #1d2b4817}.copy{position:fixed;right:24px;top:18px;z-index:10;border:0;border-radius:999px;padding:11px 18px;background:#f15b36;color:#fff;font-weight:700;box-shadow:0 8px 22px #f15b3645;cursor:pointer}@media(max-width:980px){.shell{display:block;max-width:760px}.assistant{position:static;margin-top:18px;max-height:none}.copy{right:14px;top:12px}}@media(max-width:560px){.shell{padding:0;margin:0}.paper{padding:28px 19px!important}}</style></head>
<body><button id="copy" class="copy" type="button">一键复制正文</button><main class="shell"><div class="paper" style="${paper}">
<header style="margin-bottom:28px">${logo === undefined ? "" : `<section style="float:left;margin:0 14px 0 0">${logoHtml}</section>`}<section style="${logo === undefined ? "" : "margin-left:72px"}"><p style="margin:0;color:#f15b36;font-size:13px;font-weight:800;letter-spacing:.12em">开源手记 · ${escapeHtml(plan.projectName)}</p><p style="margin:4px 0 0;color:#8a8f99;font-size:13px">虾哥不加班</p></section>${logo === undefined ? "" : `<section style="clear:both;height:0;line-height:0;font-size:0">&nbsp;</section>`}<h1 style="margin:18px 0 0;color:#121b2d;font-size:36px;line-height:1.28;letter-spacing:-.02em">${escapeHtml(plan.title)}</h1></header>
<article id="article">
${mpBlock(`<p style="margin:0;color:#596170;font-size:16px;line-height:1.75">${escapeHtml(plan.subtitle)}</p>`, "margin:0 0 18px;padding:16px 18px;background-color:#f1f4f8")}
${plan.opening.map((value) => `<p style="${paragraph}">${richText(value)}</p>`).join("")}
<h2 style="${h2}">这条路，不是从 Agent 开始的</h2>
${mpFigure(visuals[0], "职业路径")}
${plan.sections.slice(0, 1).map((section) => renderSection(section, h2, paragraph)).join("")}
${mpBlock(`<p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;line-height:1.6">${escapeHtml(plan.quote)}</p>`, "margin:30px 0;padding:24px 22px;background-color:#172f5f")}
<h2 style="${h2}">${escapeHtml(plan.mechanism.title)}</h2>
${mpFigure(visuals[1], plan.mechanism.title)}
<h2 style="${h2}">我真正想改变的，不是模型</h2>
${mpFigure(visuals[2], "前后对照")}
${plan.sections.slice(1).map((section) => renderSection(section, h2, paragraph)).join("")}
${mpBlock(`<p style="margin:0;color:#172033;font-size:21px;font-weight:700">写在最后</p><p style="${paragraph};margin-top:12px">${richText(plan.closing.summary)}</p><p style="margin:16px 0;color:#a24427;font-weight:700">${escapeHtml(plan.closing.question)}</p><p style="margin:16px 0 0;color:#172f5f;word-break:break-all">${escapeHtml(plan.repositoryUrl)}</p>`, "margin-top:48px;padding:26px;background-color:#fff3ed")}
</article></div><aside class="assistant" data-no-copy><h2 style="margin:0 0 14px;color:#172033">发布助手</h2><p style="margin:0 0 12px;color:#8a5a2b;font-size:13px">标题和作者填公众号后台，不要贴进正文。路径、流程、对照已是图片，粘贴后请确认三张图都在。</p><strong>备选标题</strong><ol style="padding-left:20px;color:#555f6d">${titles}</ol><strong>摘要</strong><p style="color:#555f6d;line-height:1.65">${escapeHtml(plan.publish.abstract)}</p><strong>标签</strong><div style="margin:8px 0 16px">${tags}</div><strong>朋友圈文案</strong><p style="color:#555f6d;line-height:1.65">${escapeHtml(plan.publish.shareCopy)}</p><details><summary style="cursor:pointer;font-weight:700">封面提示词</summary><p style="color:#697080;line-height:1.6;white-space:pre-wrap">${escapeHtml(renderCoverPrompt(plan))}</p></details><details style="margin-top:12px"><summary style="cursor:pointer;font-weight:700">事实证据</summary><ul style="padding-left:18px;color:#555f6d">${evidence}</ul></details></aside></main>
<script>${copyScript}</script></body></html>\n`;
}

function renderPublishCopy(plan: ArticlePlan): string {
  return `# 发布文案\n\n## 标题\n\n${plan.title}\n\n## 作者\n\n虾哥不加班\n\n## 摘要（不超过 120 字）\n\n${plan.publish.abstract}\n\n## 封面提示词\n\n${renderCoverPrompt(plan)}\n`;
}

function renderCoverPrompt(plan: ArticlePlan): string {
  return `微信公众号横版封面。主标题必须原样写出：「${plan.title}」。作者「虾哥不加班」，左下角小字项目名「${plan.projectName}」。标题放顶部安全区，字要大、能读清；不要改写标题，不要另起营销口号。摘要只用来理解主题，不要把整段摘要铺进画面：${plan.publish.abstract}\n\n画面：${plan.publish.coverPrompt}`;
}

function richText(value: string): string {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/gu, "<strong style=\"color:#172033\">$1</strong>");
}

async function inlineImage(root: string, path: string): Promise<string> {
  const absolute = resolveInside(root, path);
  const info = await stat(absolute).catch(() => undefined);
  if (!info?.isFile() || info.size > 1_000_000) throw invalid("logoPath 必须是 1MB 内的工作区图片");
  const mime = extname(absolute).toLowerCase() === ".svg" ? "image/svg+xml" : extname(absolute).toLowerCase() === ".jpg" || extname(absolute).toLowerCase() === ".jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${(await readFile(absolute)).toString("base64")}`;
}

function items(value: unknown, name: string, min: number, max: number): Item[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw invalid(`${name} 必须是 ${min}～${max} 项`);
  return value.map((entry, index) => {
    const raw = record(entry, `${name}[${index}]`);
    return { title: text(raw.title, `${name}[${index}].title`, 2, 32), text: text(raw.text, `${name}[${index}].text`, 8, 180) };
  });
}

function strings(value: unknown, name: string, min: number, max: number, minLength: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw invalid(`${name} 必须是 ${min}～${max} 项，当前 ${Array.isArray(value) ? value.length : "缺失"}`);
  }
  return value.map((item, index) => text(item, `${name}[${index}]`, minLength, maxLength));
}

function objectField(value: Record<string, unknown>, name: string): Record<string, unknown> { return record(value[name], name); }
function stringField(value: Record<string, unknown>, name: string): string { return text(value[name], name, 1, 240); }
function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid(`${name} 必须是对象`);
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, min: number, max: number): string {
  if (typeof value !== "string") throw invalid(`${name} 必须是字符串`);
  const length = value.trim().length;
  if (length < min || length > max) throw invalid(`${name} 长度必须是 ${min}～${max}，当前 ${length} 字`);
  return value.trim();
}
function httpUrl(value: unknown): string {
  const url = text(value, "repositoryUrl", 8, 240);
  if (!/^https:\/\//u.test(url)) throw invalid("repositoryUrl 必须使用 https");
  return url;
}
function resolveInside(root: string, path: string): string {
  if (isAbsolute(path)) throw invalid("路径必须是工作区相对路径");
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw invalid("路径越出工作区");
  return absolute;
}
function escapeHtml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function invalid(message: string): ToolError { return new ToolError(message, "WECHAT_ARTICLE_INVALID"); }
