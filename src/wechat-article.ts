import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { ToolError, type ToolRegistry } from "./tools.ts";

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
    description: "把精简的结构化文章方案渲染成精致的公众号 HTML，并生成只含标题、摘要和封面提示词的发布文案.md。模板内置职业时间线、机制流程、前后对照、观点卡片、发布助手和富文本一键复制；模型不要自行编写 HTML/CSS/JS。",
    parameters: {
      type: "object",
      properties: {
        outputDir: { type: "string", description: "工作区内输出目录，固定建议 wechat" },
        plan: {
          type: "object",
          description: "结构化文章：title、subtitle、projectName、repositoryUrl、可选 logoPath；opening 2～3 段；journey 3～5 节点；mechanism.steps 3～6 步；comparison 前后各 2～4 点；sections 2～4 节；quote；closing；publish；evidence 3～8 条。正文总量控制在 1800～2600 个汉字，面向普通开发者，少术语、少源码路径。",
        },
      },
      required: ["outputDir", "plan"],
      additionalProperties: false,
    },
    executionMode: { kind: "exclusive" },
    async execute(args) {
      const input = record(args, "args");
      const output = resolveInside(root, stringField(input, "outputDir"));
      const plan = parsePlan(objectField(input, "plan"));
      const logo = plan.logoPath === undefined ? undefined : await inlineImage(root, plan.logoPath);
      const html = renderArticle(plan, logo);
      await mkdir(output, { recursive: true });
      const file = resolve(output, "article.html");
      const publishFile = resolve(output, "发布文案.md");
      await Promise.all([
        writeFile(file, html, "utf8"),
        writeFile(publishFile, renderPublishCopy(plan), "utf8"),
      ]);
      return JSON.stringify({
        status: "created",
        html: file,
        publishCopy: publishFile,
        bytes: Buffer.byteLength(html),
        journeyNodes: plan.journey.length,
        flowSteps: plan.mechanism.steps.length,
        visualModules: 4,
        evidenceCount: plan.evidence.length,
      }, null, 2);
    },
  });
}

function parsePlan(raw: Record<string, unknown>): ArticlePlan {
  const plan: ArticlePlan = {
    title: text(raw.title, "title", 12, 60),
    subtitle: text(raw.subtitle, "subtitle", 20, 160),
    projectName: text(raw.projectName, "projectName", 2, 60),
    repositoryUrl: httpUrl(raw.repositoryUrl),
    ...(raw.logoPath === undefined ? {} : { logoPath: text(raw.logoPath, "logoPath", 1, 240) }),
    opening: strings(raw.opening, "opening", 2, 3, 50, 260),
    journey: items(raw.journey, "journey", 3, 5),
    mechanism: parseMechanism(raw.mechanism),
    comparison: parseComparison(raw.comparison),
    sections: parseSections(raw.sections),
    quote: text(raw.quote, "quote", 20, 180),
    closing: parseClosing(raw.closing),
    publish: parsePublish(raw.publish),
    evidence: parseEvidence(raw.evidence),
  };
  const articleChars = JSON.stringify({
    opening: plan.opening,
    journey: plan.journey,
    mechanism: plan.mechanism,
    comparison: plan.comparison,
    sections: plan.sections,
    quote: plan.quote,
    closing: plan.closing,
  }).length;
  if (articleChars < 1_200 || articleChars > 7_000) throw invalid("正文内容必须保持精炼，结构化字符数应为 1200～7000");
  return plan;
}

function parseMechanism(value: unknown): ArticlePlan["mechanism"] {
  const raw = record(value, "mechanism");
  return { title: text(raw.title, "mechanism.title", 4, 40), steps: items(raw.steps, "mechanism.steps", 3, 6) };
}

function parseComparison(value: unknown): ArticlePlan["comparison"] {
  const raw = record(value, "comparison");
  return {
    beforeTitle: text(raw.beforeTitle, "comparison.beforeTitle", 2, 30),
    before: strings(raw.before, "comparison.before", 2, 4, 4, 80),
    afterTitle: text(raw.afterTitle, "comparison.afterTitle", 2, 30),
    after: strings(raw.after, "comparison.after", 2, 4, 4, 80),
  };
}

function parseSections(value: unknown): ArticlePlan["sections"] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) throw invalid("sections 必须是 2～4 节");
  return value.map((entry, index) => {
    const raw = record(entry, `sections[${index}]`);
    return {
      title: text(raw.title, `sections[${index}].title`, 3, 36),
      paragraphs: strings(raw.paragraphs, `sections[${index}].paragraphs`, 1, 3, 40, 420),
      ...(raw.takeaway === undefined ? {} : { takeaway: text(raw.takeaway, `sections[${index}].takeaway`, 10, 120) }),
    };
  });
}

function parseClosing(value: unknown): ArticlePlan["closing"] {
  const raw = record(value, "closing");
  return {
    summary: text(raw.summary, "closing.summary", 30, 260),
    question: text(raw.question, "closing.question", 10, 140),
  };
}

function parsePublish(value: unknown): ArticlePlan["publish"] {
  const raw = record(value, "publish");
  return {
    titles: strings(raw.titles, "publish.titles", 3, 5, 10, 70),
    abstract: text(raw.abstract, "publish.abstract", 20, 120),
    tags: strings(raw.tags, "publish.tags", 2, 5, 2, 24),
    shareCopy: text(raw.shareCopy, "publish.shareCopy", 20, 240),
    coverPrompt: text(raw.coverPrompt, "publish.coverPrompt", 30, 500),
  };
}

function parseEvidence(value: unknown): ArticlePlan["evidence"] {
  if (!Array.isArray(value) || value.length < 3 || value.length > 8) throw invalid("evidence 必须是 3～8 条");
  return value.map((entry, index) => {
    const raw = record(entry, `evidence[${index}]`);
    return {
      claim: text(raw.claim, `evidence[${index}].claim`, 8, 160),
      source: text(raw.source, `evidence[${index}].source`, 3, 160),
    };
  });
}

function mpTable(rows: string, extra = ""): string {
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;${extra}">${rows}</table>`;
}

function renderJourney(items: Item[]): string {
  const rows = items.map((item, index) => {
    const last = index === items.length - 1;
    const pad = last ? "0" : "0 0 18px";
    const bg = last ? "#f15b36" : "#172f5f";
    return `<tr><td style="width:40px;vertical-align:top;padding:${pad}"><p style="margin:0;width:28px;height:28px;line-height:28px;text-align:center;background:${bg};color:#ffffff;font-size:14px;font-weight:700">${index + 1}</p></td><td style="vertical-align:top;padding:${pad}"><p style="margin:0;color:#172033;font-size:17px;font-weight:700;line-height:1.5">${escapeHtml(item.title)}</p><p style="margin:6px 0 0;color:#5f6673;font-size:15px;line-height:1.7">${escapeHtml(item.text)}</p></td></tr>`;
  }).join("");
  return mpTable(`<tr><td style="padding:18px;background:#f5f7fa">${mpTable(rows)}</td></tr>`);
}

function renderFlow(steps: Item[]): string {
  const rows = steps.flatMap((step, index) => {
    const card = `<tr><td style="padding:8px 0">${mpTable(`<tr><td style="padding:14px 16px;background:#ffffff;border:1px solid #d7dce5"><p style="margin:0;color:#172033;font-size:16px;font-weight:700;text-align:center">${escapeHtml(step.title)}</p><p style="margin:6px 0 0;color:#707784;font-size:13px;line-height:1.6;text-align:center">${escapeHtml(step.text)}</p></td></tr>`)}</td></tr>`;
    const arrow = index === steps.length - 1 ? "" : `<tr><td style="padding:2px 0;color:#f15b36;font-size:18px;font-weight:700;text-align:center">↓</td></tr>`;
    return [card, arrow];
  }).join("");
  return mpTable(`<tr><td style="padding:14px;background:#f5f7fa">${mpTable(rows)}</td></tr>`);
}

function renderCompare(plan: ArticlePlan["comparison"]): string {
  const column = (title: string, values: string[], accent: string) => {
    const lines = values.map((value) => `<p style="margin:8px 0;color:#444b57"><span style="color:${accent};font-weight:800">✓ </span>${escapeHtml(value)}</p>`).join("");
    return `<td style="width:50%;vertical-align:top;padding:16px;background:#ffffff;border:1px solid #e2e4e9"><p style="margin:0 0 12px;color:${accent};font-size:18px;font-weight:700">${escapeHtml(title)}</p>${lines}</td>`;
  };
  return mpTable(`<tr>${column(plan.beforeTitle, plan.before, "#89909b")}<td style="width:12px;font-size:1px">&nbsp;</td>${column(plan.afterTitle, plan.after, "#f15b36")}</tr>`);
}

function renderTakeaway(text: string): string {
  return mpTable(`<tr><td style="width:6px;background:#f15b36;font-size:1px">&nbsp;</td><td style="padding:16px 18px;background:#fff3ed;color:#7b331f;font-weight:650;line-height:1.7">${escapeHtml(text)}</td></tr>`, "margin:22px 0");
}

function renderSection(section: ArticlePlan["sections"][number], h2: string, paragraph: string): string {
  const body = section.paragraphs.map((value) => `<p style="${paragraph}">${richText(value)}</p>`).join("");
  const takeaway = section.takeaway === undefined ? "" : renderTakeaway(section.takeaway);
  return `<h2 style="${h2}">${escapeHtml(section.title)}</h2>${body}${takeaway}`;
}

function renderArticle(plan: ArticlePlan, logo?: string): string {
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
<header style="margin-bottom:28px">${mpTable(`<tr>${logo === undefined ? "" : `<td style="width:70px;vertical-align:middle;padding:0 14px 0 0">${logoHtml}</td>`}<td style="vertical-align:middle"><p style="margin:0;color:#f15b36;font-size:13px;font-weight:800;letter-spacing:.12em">开源手记 · ${escapeHtml(plan.projectName)}</p><p style="margin:4px 0 0;color:#8a8f99;font-size:13px">虾哥不加班</p></td></tr>`)}<h1 style="margin:18px 0 0;color:#121b2d;font-size:36px;line-height:1.28;letter-spacing:-.02em">${escapeHtml(plan.title)}</h1></header>
<article id="article">
${mpTable(`<tr><td style="padding:16px 18px;background:#f1f4f8;color:#596170;font-size:16px;line-height:1.75">${escapeHtml(plan.subtitle)}</td></tr>`)}
${plan.opening.map((value) => `<p style="${paragraph}">${richText(value)}</p>`).join("")}
<h2 style="${h2}">这条路，不是从 Agent 开始的</h2>
${renderJourney(plan.journey)}
${plan.sections.slice(0, 1).map((section) => renderSection(section, h2, paragraph)).join("")}
${mpTable(`<tr><td style="padding:24px 26px;background:#172f5f;color:#ffffff;font-size:20px;font-weight:700;line-height:1.6">${escapeHtml(plan.quote)}</td></tr>`, "margin:30px 0")}
<h2 style="${h2}">${escapeHtml(plan.mechanism.title)}</h2>
${renderFlow(plan.mechanism.steps)}
<h2 style="${h2}">我真正想改变的，不是模型</h2>
${renderCompare(plan.comparison)}
${plan.sections.slice(1).map((section) => renderSection(section, h2, paragraph)).join("")}
${mpTable(`<tr><td style="padding:26px;background:#fff3ed"><p style="margin:0;color:#172033;font-size:21px;font-weight:700">写在最后</p><p style="${paragraph};margin-top:12px">${richText(plan.closing.summary)}</p><p style="margin:16px 0;color:#a24427;font-weight:700">${escapeHtml(plan.closing.question)}</p><p style="margin:16px 0 0;color:#172f5f;word-break:break-all">${escapeHtml(plan.repositoryUrl)}</p></td></tr>`, "margin-top:48px")}
</article></div><aside class="assistant" data-no-copy><h2 style="margin:0 0 14px;color:#172033">发布助手</h2><p style="margin:0 0 12px;color:#8a5a2b;font-size:13px">标题和作者填公众号后台，不要贴进正文。</p><strong>备选标题</strong><ol style="padding-left:20px;color:#555f6d">${titles}</ol><strong>摘要</strong><p style="color:#555f6d;line-height:1.65">${escapeHtml(plan.publish.abstract)}</p><strong>标签</strong><div style="margin:8px 0 16px">${tags}</div><strong>朋友圈文案</strong><p style="color:#555f6d;line-height:1.65">${escapeHtml(plan.publish.shareCopy)}</p><details><summary style="cursor:pointer;font-weight:700">封面提示词</summary><p style="color:#697080;line-height:1.6">${escapeHtml(plan.publish.coverPrompt)}</p></details><details style="margin-top:12px"><summary style="cursor:pointer;font-weight:700">事实证据</summary><ul style="padding-left:18px;color:#555f6d">${evidence}</ul></details></aside></main>
<script>${copyScript}</script></body></html>\n`;
}

function renderPublishCopy(plan: ArticlePlan): string {
  return `# 发布文案\n\n## 标题\n\n${plan.title}\n\n## 作者\n\n虾哥不加班\n\n## 摘要（不超过 120 字）\n\n${plan.publish.abstract}\n\n## 封面提示词\n\n${plan.publish.coverPrompt}\n`;
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
  if (!Array.isArray(value) || value.length < min || value.length > max) throw invalid(`${name} 必须是 ${min}～${max} 项`);
  return value.map((item, index) => text(item, `${name}[${index}]`, minLength, maxLength));
}

function objectField(value: Record<string, unknown>, name: string): Record<string, unknown> { return record(value[name], name); }
function stringField(value: Record<string, unknown>, name: string): string { return text(value[name], name, 1, 240); }
function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid(`${name} 必须是对象`);
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, min: number, max: number): string {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) throw invalid(`${name} 长度必须是 ${min}～${max}`);
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
