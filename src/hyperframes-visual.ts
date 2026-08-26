export type VisualScene = {
  id: string;
  title: string;
  narration: string;
  duration: number;
  template?: "hook" | "flow" | "compare" | "points" | "boundary";
  eyebrow?: string;
  bullets?: string[];
  sourceLabel?: string;
};

export type VisualPlan = {
  projectName: string;
  creatorName?: string;
  repositoryUrl?: string;
  logoPath?: string;
  scenes: VisualScene[];
};

const KICKERS = {
  hook: "HOOK · 它是什么",
  flow: "FLOW · 主链路",
  compare: "COMPARE · 两种做法",
  points: "POINTS · 关键点",
  boundary: "BOUNDARY · 边界",
} as const;

export function renderFrame(plan: VisualPlan, scene: VisualScene, index: number): string {
  const template = scene.template ?? "points";
  const duration = scene.duration;
  const repository = repositoryLabel(plan.repositoryUrl ?? "");
  const page = String(index + 1).padStart(2, "0");
  const creator = plan.creatorName ?? "虾哥不加班";
  const items = sceneItems(scene);
  const stamp = scene.sourceLabel === undefined ? "" : `<p class="kicker-stamp">${escapeHtml(scene.sourceLabel)}</p>`;
  const logo = plan.logoPath === undefined || index !== 0
    ? ""
    : `<img class="brand-mark" src="${escapeHtml(plan.logoPath)}" alt="">`;
  const band = index === plan.scenes.length - 1
    ? `GitHub 搜索 ${repository} · 关注「${creator}」`
    : takeaway(scene);
  const stage = renderStage(template, items, duration);
  return `<template>
<style>
${fontFaces()}
#root{position:absolute;inset:0;width:1080px;height:1920px;overflow:hidden;container-type:size;color:#141412;background:#F6F6F2}
.f-bg{position:absolute;inset:0;background-color:#F6F6F2;background-image:repeating-linear-gradient(0deg,rgba(20,20,18,.045) 0 1px,transparent 1px 3px),linear-gradient(to right,rgba(20,20,18,.06) 1px,transparent 1px),linear-gradient(to bottom,rgba(20,20,18,.06) 1px,transparent 1px);background-size:100% 3px,4cqw 4cqw,4cqw 4cqw}
.f-grain{position:absolute;inset:0;opacity:.16;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.78' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.f-chrome{position:absolute;inset:0}
.hair{position:absolute;left:4cqw;right:4cqw;height:0.14cqw;background:#141412}
.hair-top{top:3cqw}.hair-bot{top:93cqh}
.brand{position:absolute;left:4cqw;top:3.4cqw;margin:0;display:flex;align-items:center;gap:1.1cqw;font-family:"Consola",monospace;font-size:1.6cqw;letter-spacing:.14em;color:#3D4F44}
.brand b{font-weight:400;color:#141412;letter-spacing:.06em}
.brand-mark{width:3.4cqw;height:3.4cqw;object-fit:cover;border:0.16cqw solid #141412;transform:rotate(-2deg);box-shadow:1px 1px 0 #141412}
.page{position:absolute;right:4cqw;top:3.4cqw;margin:0;font-family:"Consola",monospace;font-size:1.5cqw;letter-spacing:.08em;color:#3D4F44}
.f-head{position:absolute;left:6cqw;width:88cqw;top:8.8cqh}
.kicker{margin:0 0 1.4cqw;font-family:"Consola",monospace;font-size:1.6cqw;letter-spacing:.18em;color:#155E75}
.kicker-stamp{margin:.5cqw 0 0;font-family:"Consola",monospace;font-size:1.3cqw;letter-spacing:.08em;color:#3D4F44}
.f-head h1{margin:0;font-family:"Georgia","SimHei",serif;font-size:5.4cqw;font-weight:400;letter-spacing:-.006em;line-height:1.08;color:#141412;text-shadow:0.5px 0 0 rgba(20,20,18,.18),-0.4px 0.5px 0 rgba(20,20,18,.08)}
.f-head h1 em{font-style:italic;color:#141412;background-image:linear-gradient(transparent 58%,rgba(8,145,178,.42) 58%);box-decoration-break:clone;-webkit-box-decoration-break:clone}
.f-band{position:absolute;left:6cqw;right:6cqw;top:79cqh;box-sizing:border-box;background:#0891B2;padding:2.4cqw 3cqw;border-radius:3px 9px 5px 8px;box-shadow:1px 1px 0 #155E75}
.f-band p{margin:0;font-family:"SimHei",sans-serif;font-size:3.6cqw;letter-spacing:.03em;line-height:1.22;color:#fff;text-align:center}
${stage.css}
</style>
<script src="assets/vendor/gsap.min.js"></script>
<div id="root" data-composition-id="${escapeHtml(scene.id)}" data-width="1080" data-height="1920" data-duration="${duration}">
  <div id="f-bg" class="clip f-bg" data-start="0" data-duration="${duration}" data-track-index="0"></div>
  <div id="f-grain" class="clip f-grain" data-start="0" data-duration="${duration}" data-track-index="1"></div>
  <div id="f-chrome" class="clip f-chrome" data-start="0" data-duration="${duration}" data-track-index="2">
    <div class="hair hair-top"></div><div class="hair hair-bot"></div>
    <p class="brand">${logo}<b>${escapeHtml(plan.projectName.toUpperCase())}</b> · ${escapeHtml(creator)}</p>
    <p class="page">${page}</p>
  </div>
  <div id="f-head" class="clip f-head" data-start="0" data-duration="${duration}" data-track-index="3">
    <p class="kicker">${escapeHtml(scene.eyebrow ?? KICKERS[template])}</p>
    <h1>${titleMarkup(scene.title)}</h1>${stamp}
  </div>
  ${stage.html}
  <div id="f-band" class="clip f-band" data-start="0" data-duration="${duration}" data-track-index="${stage.bandTrack}">
    <p>${escapeHtml(band)}</p>
  </div>
</div>
<script>
window.__timelines=window.__timelines||{};
const tl=gsap.timeline({paused:true});
tl.fromTo("#f-head",{y:-40,opacity:0},{y:0,opacity:1,duration:.6,ease:"power2.out"},0);
${stage.motion}
tl.fromTo("#f-band",{y:26,opacity:0,rotation:-1.2},{y:0,opacity:1,rotation:-0.4,duration:.5,ease:"back.out(1.4)"},Math.max(2.2,${duration}*.62));
window.__timelines["${escapeJs(scene.id)}"]=tl;
</script>
</template>
`;
}

export function renderCaptions(plan: VisualPlan): string {
  let cursor = 0;
  const cues = plan.scenes.map((scene) => {
    const start = cursor;
    cursor += scene.duration;
    return { start, end: cursor, text: scene.narration };
  });
  return `<template>
<style>
${fontFaces()}
#root{position:absolute;inset:0;width:1080px;height:1920px;pointer-events:none}
.f-caption{position:absolute;left:8cqw;right:8cqw;top:83.6cqh;padding:1.6cqw 2.4cqw 1.8cqw;background:#F6F6F2;background-image:linear-gradient(to bottom,rgba(20,20,18,.07) 1px,transparent 1px);background-size:100% 1.8cqw;border-top:0.18cqw solid #141412;border-bottom:0.18cqw solid #141412}
.f-caption p{margin:0;font-family:"Georgia","SimHei",serif;font-size:3.4cqw;line-height:1.22;text-align:center;color:#141412}
</style>
<script src="assets/vendor/gsap.min.js"></script>
<div id="root" data-composition-id="captions" data-width="1080" data-height="1920" data-duration="${cursor}">
  <div id="f-caption" class="clip f-caption" data-start="0" data-duration="${cursor}" data-track-index="0"><p></p></div>
</div>
<script>
const cues=${JSON.stringify(cues)};
const node=document.querySelector("#f-caption p");
window.__timelines=window.__timelines||{};
const tl=gsap.timeline({paused:true});
cues.forEach(c=>tl.call(()=>{node.textContent=c.text;},[],c.start));
window.__timelines.captions=tl;
</script>
</template>
`;
}

type Stage = { html: string; css: string; motion: string; bandTrack: number };

function renderStage(template: NonNullable<VisualScene["template"]>, items: string[], duration: number): Stage {
  if (template === "compare") return compareStage(items, duration);
  if (template === "flow" || template === "hook") return diagramStage(items, duration, template === "hook");
  return cardsStage(items, duration, template === "boundary");
}

function diagramStage(items: string[], duration: number, hook: boolean): Stage {
  const nodes = items.slice(0, 3);
  while (nodes.length < 2) nodes.push(nodes[0] ?? "下一步");
  const nodeHtml = nodes.map((item, i) => `<div class="node n${i + 1}"><p>${escapeHtml(shortLabel(item, 8))}</p></div>`).join("");
  const arrows = nodes.slice(0, -1).map((_, i) => `<div class="arrow a${i + 1}"></div>`).join("");
  const tilt = hook ? "-0.7" : "0.5";
  return {
    bandTrack: 5,
    css: `.f-stage{position:absolute;left:6cqw;width:88cqw;top:28cqh;height:46cqh;box-sizing:border-box;background:#141412;padding:3cqw;overflow:hidden;border-radius:4px 10px 6px 8px;box-shadow:1px 1px 0 #0891B2}
.tag{margin:0 0 2cqw;font-family:"Consola",monospace;font-size:1.2cqw;letter-spacing:.1em;color:#A8A29E}
.node{position:absolute;width:24%;height:28%;box-sizing:border-box;background:#26261F;border:0.28cqw solid #0891B2;display:flex;align-items:center;justify-content:center;border-radius:3px 8px 5px 9px;box-shadow:1px 1px 0 #0891B2}
.node p{margin:0;font-family:"SimHei",sans-serif;font-size:2.2cqw;color:#A5F3FC;text-align:center;padding:0.6cqw}
.n1{left:8%;top:28%}.n2{left:38%;top:28%}.n3{left:68%;top:28%}
.arrow{position:absolute;top:40%;height:0.22cqw;background:#0891B2;transform-origin:left center}
.a1{left:33%;width:4.4%}.a2{left:63%;width:4.4%}
.sketch{position:absolute;left:8%;right:8%;top:68%;height:12%;overflow:visible}
.sketch path{fill:none;stroke:#67E8F9;stroke-width:3;stroke-linecap:round}`,
    html: `<div id="f-stage" class="clip f-stage" data-start="0" data-duration="${duration}" data-track-index="4">
    <p class="tag">${hook ? "GRAPH · 先看见再跑" : "PIPELINE · 按序发生"}</p>
    ${nodeHtml}${arrows}
    <svg class="sketch" viewBox="0 0 240 36" preserveAspectRatio="none"><path id="f-draw" d="M4 22 C 50 8, 90 30, 140 14 S 210 28, 236 16" stroke-dasharray="260" stroke-dashoffset="260"></path></svg>
  </div>`,
    motion: `tl.fromTo("#f-stage",{y:42,opacity:0,rotation:-2},{y:0,opacity:1,rotation:${tilt},duration:.65,ease:"power2.out"},1.1);
document.querySelectorAll(".node").forEach((n,i)=>{tl.fromTo(n,{scale:.72,opacity:0},{scale:1,opacity:1,duration:.38,ease:"back.out(1.6)"},1.8+i*.35)});
tl.fromTo(".arrow",{scaleX:0},{scaleX:1,duration:.35,ease:"power2.out"},2.3);
tl.fromTo("#f-draw",{strokeDashoffset:260},{strokeDashoffset:0,duration:1.05,ease:"power2.inOut"},2.5);`,
  };
}

function compareStage(items: string[], duration: number): Stage {
  const left = splitPair(items[0] ?? "之前");
  const right = splitPair(items[1] ?? "之后");
  return {
    bandTrack: 7,
    css: `.f-left,.f-right{position:absolute;width:40cqw;top:32cqh;box-sizing:border-box;padding:2.6cqw;border-radius:3px 9px 6px 8px}
.f-left{left:6cqw;background:#F6F6F2;border:0.22cqw solid #141412;box-shadow:1px 1px 0 #141412}
.f-right{right:6cqw;background:#A5F3FC;border:0.22cqw solid #0891B2;box-shadow:1px 1px 0 #155E75}
.f-left h3,.f-right h3{margin:0 0 1.2cqw;font-family:"SimHei",sans-serif;font-size:3cqw}
.f-left h3{color:#141412}.f-right h3{color:#155E75}
.pair-tag{margin:0 0 1.4cqw;font-family:"Consola",monospace;font-size:1.4cqw;letter-spacing:.1em;color:#3D4F44}
.f-left p,.f-right p{margin:.6cqw 0;font-family:"SimHei",sans-serif;font-size:2.5cqw;line-height:1.3}
.f-left p{color:#141412}.f-right p{color:#155E75}
.f-vs{position:absolute;left:46cqw;top:48cqh;font-family:"Consola",monospace;font-size:3cqw;color:#3D4F44}`,
    html: `<div id="f-left" class="clip f-left" data-start="0" data-duration="${duration}" data-track-index="4">
    <h3>${escapeHtml(left.k)}</h3><p class="pair-tag">BEFORE</p><p>${escapeHtml(left.v || left.k)}</p>
  </div>
  <div id="f-vs" class="clip f-vs" data-start="0" data-duration="${duration}" data-track-index="5">VS</div>
  <div id="f-right" class="clip f-right" data-start="0" data-duration="${duration}" data-track-index="6">
    <h3>${escapeHtml(right.k)}</h3><p class="pair-tag">AFTER</p><p>${escapeHtml(right.v || right.k)}</p>
  </div>`,
    motion: `tl.fromTo("#f-left",{x:-34,opacity:0,rotation:-4},{x:0,opacity:1,rotation:-1.1,duration:.55,ease:"power2.out"},1.3);
tl.fromTo("#f-right",{x:34,opacity:0,rotation:4},{x:0,opacity:1,rotation:1.2,duration:.55,ease:"power2.out"},1.9);
tl.fromTo("#f-vs",{scale:.5,opacity:0},{scale:1,opacity:1,duration:.4,ease:"back.out(1.8)"},2.4);`,
  };
}

function cardsStage(items: string[], duration: number, hotLast: boolean): Stage {
  const cards = items.slice(0, 4);
  const css = cards.map((_, i) => {
    const top = 28 + i * 12;
    const rot = ((i % 2 === 0 ? -1 : 1) * (0.55 + i * 0.18)).toFixed(1);
    const hot = hotLast && i === cards.length - 1;
    return `.f-c${i + 1}{position:absolute;left:6cqw;width:88cqw;top:${top}cqh;box-sizing:border-box;padding:2.3cqw 3cqw;display:flex;align-items:baseline;justify-content:space-between;gap:2cqw;border-radius:3px 8px 5px 9px;border:0.22cqw solid ${hot ? "#0891B2" : "#141412"};background:${hot ? "#A5F3FC" : "#F6F6F2"};box-shadow:1px 1px 0 ${hot ? "#155E75" : "#141412"}}`;
  }).join("\n");
  const html = cards.map((item, i) => {
    const pair = splitPair(item);
    const hot = hotLast && i === cards.length - 1;
    return `<div id="f-c${i + 1}" class="clip f-c${i + 1}" data-start="0" data-duration="${duration}" data-track-index="${4 + i}">
    <span class="k">${escapeHtml(pair.k)}</span><span class="v${hot ? " hot" : ""}">${escapeHtml(pair.v || pair.k)}</span>
  </div>`;
  }).join("\n  ");
  const motion = cards.map((_, i) => `tl.fromTo("#f-c${i + 1}",{x:-28,opacity:0,rotation:-2},{x:0,opacity:1,rotation:${((i % 2 === 0 ? -1 : 1) * (0.55 + i * 0.18)).toFixed(1)},duration:.48,ease:"back.out(1.4)"},${(1.4 + i * 0.45).toFixed(2)});`).join("\n");
  return {
    bandTrack: 4 + cards.length,
    css: `${css}
.k{font-family:"SimHei",sans-serif;font-size:2.8cqw;color:#141412}
.v{font-family:"SimHei",sans-serif;font-size:2.4cqw;color:#3D4F44;text-align:right}
.v.hot{color:#155E75}`,
    html,
    motion,
  };
}

function fontFaces(): string {
  return `@font-face{font-family:"Georgia";src:url("assets/fonts/Georgia.ttf") format("truetype"),local("Georgia");font-weight:400;font-display:block}
@font-face{font-family:"Georgia";src:url("assets/fonts/Georgia-Bold.ttf") format("truetype"),local("Georgia");font-weight:700;font-display:block}
@font-face{font-family:"Consola";src:url("assets/fonts/Consola.ttf") format("truetype"),local("Consolas"),local("Menlo");font-weight:400;font-display:block}
@font-face{font-family:"SimHei";src:local("Heiti SC"),local("STHeiti"),local("PingFang SC"),local("SimHei");font-weight:400;font-display:block}`;
}

function sceneItems(scene: VisualScene): string[] {
  if (scene.bullets?.length) return scene.bullets.slice(0, 4);
  const parts = scene.narration.split(/[，。；]/u).map((item) => item.trim()).filter(Boolean);
  return (parts.length >= 2 ? parts : [scene.narration]).slice(0, 3);
}

function takeaway(scene: VisualScene): string {
  if (scene.bullets?.length) return scene.bullets.at(-1)!;
  const first = scene.narration.split(/[。！？]/u).map((item) => item.trim()).find(Boolean);
  return first ?? scene.narration;
}

function titleMarkup(title: string): string {
  const idx = Math.max(title.lastIndexOf("："), title.lastIndexOf("，"));
  if (idx > 0 && idx < title.length - 1) {
    return `${escapeHtml(title.slice(0, idx + 1))}<em>${escapeHtml(title.slice(idx + 1))}</em>`;
  }
  return escapeHtml(title);
}

function splitPair(text: string): { k: string; v: string } {
  const idx = text.search(/[：:]/u);
  if (idx > 0) return { k: text.slice(0, idx).trim(), v: text.slice(idx + 1).trim() };
  return { k: text, v: "" };
}

function shortLabel(text: string, max: number): string {
  const compact = text.replace(/[：:].*$/u, "").trim();
  return compact.length <= max ? compact : `${compact.slice(0, max)}…`;
}

function repositoryLabel(url: string): string {
  return url.replace(/^https:\/\/github\.com\//u, "").replace(/\/$/u, "");
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}

function escapeJs(text: string): string {
  return text.replace(/[\\"\n\r]/gu, (char) => ({ "\\": "\\\\", "\"": "\\\"", "\n": "\\n", "\r": "\\r" })[char]!);
}
