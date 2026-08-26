export type FrameKind = "hook" | "flow" | "compare" | "points" | "boundary";

export type VisualScene = {
  id: string;
  title: string;
  narration: string;
  duration: number;
  template?: FrameKind;
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

const KICKERS: Record<FrameKind, string> = {
  hook: "HOOK · 先看见问题",
  flow: "PIPELINE · 主链路",
  compare: "TWO WAYS · 两种做法",
  points: "ONE PRINCIPLE",
  boundary: "BOUNDARY · 边界",
};

export function resolveVisualTemplate(scene: VisualScene, index: number, total: number): FrameKind {
  if (scene.template) return scene.template;
  if (index === 0) return "hook";
  if (index === total - 1) return "boundary";
  return (["flow", "compare", "points"] as const)[(index - 1) % 3];
}

export function renderFrame(plan: VisualPlan, scene: VisualScene, index: number): string {
  const p = `f${String(index + 1).padStart(2, "0")}`;
  const kind = resolveVisualTemplate(scene, index, plan.scenes.length);
  const duration = scene.duration;
  const items = sceneItems(scene);
  const kicker = scene.eyebrow ?? (kind === "flow" && items.length >= 4 ? "GRAPH · 能回头" : KICKERS[kind]);
  const stamp = scene.sourceLabel === undefined ? "" : `<p class="${p}-stamp">${escapeHtml(scene.sourceLabel)}</p>`;
  const title = titleMarkup(scene.title, p);
  const stage = renderStage(kind, p, items, duration, takeaway(scene, plan, index));
  const logo = plan.logoPath === undefined || index !== 0
    ? ""
    : `<img class="${p}-mark" src="${escapeHtml(plan.logoPath)}" alt="">`;
  const creator = plan.creatorName ?? "虾哥不加班";
  const page = String(index + 1).padStart(2, "0");
  const heading = kind === "hook" || kind === "points" ? "h1" : "h2";
  return `<template>
<style>
${fontFaces()}
${stage.paper ? paperShell(p) : inkShell(p)}
.${p}-head{position:absolute;left:6cqw;width:88cqw;top:${kind === "points" ? "22cqh" : kind === "hook" ? "8.6cqh" : "9cqh"}}
.${p}-kicker{margin:0 0 1.4cqw;font-family:"Consola",monospace;font-size:1.6cqw;letter-spacing:.18em;color:${stage.paper ? "#155E75" : "#67E8F9"}}
.${p}-stamp{margin:.5cqw 0 0;font-family:"Consola",monospace;font-size:1.3cqw;letter-spacing:.08em;color:${stage.paper ? "#3D4F44" : "#A8A29E"}}
.${p}-head ${heading}{margin:0;font-family:"Georgia","SimHei",serif;font-size:${kind === "hook" || kind === "points" ? "6.2cqw" : "5cqw"};font-weight:400;letter-spacing:-.006em;line-height:1.08;color:${stage.paper ? "#141412" : "#F6F6F2"};text-shadow:0.5px 0 0 rgba(20,20,18,.16),-0.4px 0.5px 0 rgba(20,20,18,.08)}
.${p}-head em{font-style:normal;color:${stage.paper ? "#0891B2" : "#67E8F9"}}
.${p}-hit{position:relative;display:inline}
.${p}-sweep{position:absolute;left:-3%;right:-3%;top:58%;height:36%;background:rgba(8,145,178,.34);border-radius:2px 9px 3px 7px;transform-origin:left center;transform:scaleX(0);pointer-events:none}
.${p}-brand{position:absolute;left:4cqw;top:${stage.paper ? "3.4cqw" : "6cqh"};margin:0;display:flex;align-items:center;gap:1.1cqw;font-family:"Consola",monospace;font-size:1.6cqw;letter-spacing:.14em;color:${stage.paper ? "#3D4F44" : "#A8A29E"}}
.${p}-brand b{font-weight:400;color:${stage.paper ? "#141412" : "#F6F6F2"};letter-spacing:.06em}
.${p}-mark{width:3.4cqw;height:3.4cqw;object-fit:cover;border:0.16cqw solid #141412;transform:rotate(-2deg);box-shadow:1px 1px 0 #141412}
.${p}-page{position:absolute;right:4cqw;top:${stage.paper ? "3.4cqw" : "6cqh"};margin:0;font-family:"Consola",monospace;font-size:1.5cqw;letter-spacing:.08em;color:${stage.paper ? "#3D4F44" : "#A8A29E"}}
${stage.css}
</style>
<script src="assets/vendor/gsap.min.js"></script>
<div id="root" data-composition-id="${escapeHtml(scene.id)}" data-width="1080" data-height="1920" data-duration="${duration}">
  <div id="${p}-bg" class="clip ${p}-bg" data-start="0" data-duration="${duration}" data-track-index="0"></div>
  ${stage.paper ? `<div id="${p}-grain" class="clip ${p}-grain" data-start="0" data-duration="${duration}" data-track-index="1"></div>` : ""}
  <div id="${p}-chrome" class="clip ${p}-chrome" data-start="0" data-duration="${duration}" data-track-index="2">
    ${stage.paper ? `<div class="${p}-hair ${p}-hair-top"></div><div class="${p}-hair ${p}-hair-bot"></div>` : ""}
    <p class="${p}-brand">${logo}<b>${escapeHtml(plan.projectName.toUpperCase())}</b> · ${escapeHtml(creator)}</p>
    <p class="${p}-page">${page}</p>
  </div>
  ${kind === "points" ? `<div id="${p}-kicker" class="clip ${p}-kicker-clip" data-start="0" data-duration="${duration}" data-track-index="3">${escapeHtml(kicker)}</div>` : ""}
  <div id="${p}-head" class="clip ${p}-head" data-start="0" data-duration="${duration}" data-track-index="${kind === "points" ? 4 : 3}">
    ${kind === "points" ? "" : `<p class="${p}-kicker">${escapeHtml(kicker)}</p>`}
    <${heading}>${title}</${heading}>${stamp}
  </div>
  ${stage.html}
</div>
<script>
window.__timelines=window.__timelines||{};
const tl=gsap.timeline({paused:true});
${kind === "points" ? `tl.fromTo("#${p}-kicker",{opacity:0},{opacity:1,duration:.35,ease:"power2.out"},.35);` : ""}
tl.fromTo("#${p}-head",{y:${kind === "hook" ? "-44" : "-40"},opacity:0},{y:0,opacity:1,duration:${kind === "hook" ? ".7" : ".6"},ease:"power3.out"},${kind === "points" ? ".75" : "0"});
tl.fromTo("#${p}-head .${p}-sweep",{scaleX:0},{scaleX:1,duration:.55,ease:"power2.out"},.8);
${stage.motion}
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
cues.forEach((c,i)=>{
  tl.call(()=>{node.textContent=c.text;},[],c.start);
  tl.fromTo("#f-caption",{opacity:i===0?0:.18},{opacity:1,duration:.45,ease:"sine.inOut"},c.start);
  tl.to("#f-caption",{opacity:.18,duration:.28,ease:"sine.inOut"},Math.max(c.start+.5,c.end-.28));
});
window.__timelines.captions=tl;
</script>
</template>
`;
}

type Stage = { html: string; css: string; motion: string; paper: boolean };

function renderStage(kind: FrameKind, p: string, items: string[], duration: number, band: string): Stage {
  if (kind === "hook") return hookStage(p, items, duration, band);
  if (kind === "compare") return compareStage(p, items, duration, band);
  if (kind === "points") return principleStage(p, items, duration);
  if (kind === "boundary") return boundaryStage(p, items, duration, band);
  return items.length >= 4 ? loopStage(p, items, duration) : pipelineStage(p, items, duration);
}

function hookStage(p: string, items: string[], duration: number, band: string): Stage {
  const wrong = shortLabel(items[0] ?? "旧做法", 8);
  const nodes = (items.slice(1, 4).length >= 2 ? items.slice(1, 4) : items.slice(0, 3)).map((item) => shortLabel(item, 8));
  while (nodes.length < 2) nodes.push("下一步");
  const nodeHtml = nodes.map((item, i) => `<div class="${p}-node ${p}-n${i + 1}"><p>${escapeHtml(item)}</p></div>`).join("");
  return {
    paper: true,
    css: `.${p}-panel{position:absolute;left:6cqw;width:88cqw;top:28cqh;height:46cqh;box-sizing:border-box;background:#141412;padding:2.4cqw 3cqw;overflow:hidden;border-radius:4px 11px 6px 8px;box-shadow:1px 1px 0 #0891B2}
.${p}-tag{margin:0 0 1.4cqw;font-family:"Consola",monospace;font-size:1.2cqw;letter-spacing:.1em;color:#A8A29E}
.${p}-wrong{position:absolute;left:6%;top:20%;width:28%;height:58%;box-sizing:border-box;background:#26261F;border:0.28cqw solid #3D4F44;border-radius:3px 8px 5px 9px}
.${p}-wrong .x{position:absolute;left:50%;top:42%;font-family:"Consola",monospace;font-size:7cqw;color:#A8A29E;transform:translate(-50%,-50%)}
.${p}-wrong p{position:absolute;left:8%;right:8%;bottom:8%;margin:0;font-family:"SimHei",sans-serif;font-size:2cqw;color:#A8A29E;text-align:center}
.${p}-scratch{position:absolute;inset:8%;overflow:visible}
.${p}-scratch path{fill:none;stroke:#F6F6F2;stroke-width:3.2;stroke-linecap:round;opacity:.72}
.${p}-arrow{position:absolute;left:38%;top:46%;font-family:"Consola",monospace;font-size:3.2cqw;color:#67E8F9}
.${p}-graph{position:absolute;left:48%;top:16%;width:48%;height:64%}
.${p}-node{position:absolute;width:38%;height:28%;box-sizing:border-box;background:#26261F;border:0.28cqw solid #0891B2;display:flex;align-items:center;justify-content:center;border-radius:3px 8px 5px 9px;box-shadow:1px 1px 0 #0891B2}
.${p}-node p{margin:0;font-family:"SimHei",sans-serif;font-size:2.1cqw;color:#A5F3FC;text-align:center;padding:.4cqw}
.${p}-n1{left:4%;top:8%}.${p}-n2{left:48%;top:8%}.${p}-n3{left:26%;top:52%}
.${p}-note{position:absolute;left:8%;right:8%;bottom:4%;margin:0;font-family:"SimHei",sans-serif;font-size:2.4cqw;color:#F6F6F2;text-align:center}
.${p}-band{position:absolute;left:6cqw;right:6cqw;top:79.4cqh;box-sizing:border-box;background:#0891B2;padding:2.4cqw 3cqw;border-radius:3px 9px 5px 8px;box-shadow:1px 1px 0 #155E75}
.${p}-band p{margin:0;font-family:"SimHei",sans-serif;font-size:3.8cqw;letter-spacing:.03em;line-height:1.18;color:#fff;text-align:center}`,
    html: `<div id="${p}-panel" class="clip ${p}-panel" data-start="0" data-duration="${duration}" data-track-index="4">
    <p class="${p}-tag">WRONG PATH · 对照</p>
    <div class="${p}-wrong"><span class="x">×</span><p>${escapeHtml(wrong)}</p>
      <svg class="${p}-scratch" viewBox="0 0 100 100" preserveAspectRatio="none"><path id="${p}-draw" d="M8 18 C 22 8, 40 30, 58 14 S 86 28, 94 12 M12 78 C 30 92, 48 60, 70 84 S 90 70, 96 88 M18 48 L 86 42" stroke-dasharray="280" stroke-dashoffset="280"></path></svg>
    </div>
    <div class="${p}-arrow">→</div>
    <div class="${p}-graph">${nodeHtml}</div>
    <p class="${p}-note">划掉死板的一条线，改成能看见的图</p>
  </div>
  <div id="${p}-band" class="clip ${p}-band" data-start="0" data-duration="${duration}" data-track-index="5"><p>${escapeHtml(band)}</p></div>`,
    motion: `tl.fromTo("#${p}-panel",{y:46,opacity:0,rotation:-1.4},{y:0,opacity:1,rotation:-0.4,duration:.7,ease:"power3.out"},1.15);
tl.fromTo(".${p}-wrong",{scale:.9,opacity:0},{scale:1,opacity:1,duration:.45,ease:"power2.out"},1.9);
tl.fromTo("#${p}-draw",{strokeDashoffset:280},{strokeDashoffset:0,duration:.9,ease:"power2.inOut"},2.2);
tl.fromTo(".${p}-arrow",{opacity:0,x:-8},{opacity:1,x:0,duration:.28,ease:"power4.out"},3.1);
document.querySelectorAll(".${p}-node").forEach((n,i)=>{tl.fromTo(n,{scale:.7,opacity:0},{scale:1,opacity:1,duration:.38,ease:"back.out(1.7)"},3.4+i*.28)});
tl.fromTo(".${p}-note",{y:12,opacity:0},{y:0,opacity:1,duration:.4,ease:"power2.out"},${late(duration, 4)});
tl.fromTo("#${p}-band",{y:26,opacity:0,rotation:-1.1},{y:0,opacity:1,rotation:-0.3,duration:.5,ease:"back.out(1.4)"},${late(duration)});`,
  };
}

function pipelineStage(p: string, items: string[], duration: number): Stage {
  const nodes = items.slice(0, 4);
  while (nodes.length < 2) nodes.push("下一步");
  const nodeHtml = nodes.map((item, i) => `<div class="${p}-node ${p}-n${i + 1}"><p>${escapeHtml(shortLabel(item, 6))}</p></div>`).join("");
  const count = Math.min(4, Math.max(2, nodes.length));
  const nodeCss = Array.from({ length: count }, (_, i) => `.${p}-n${i + 1}{left:${(i * 80) / Math.max(count - 1, 1)}%;top:4%}`).join("");
  return {
    paper: true,
    css: `.${p}-panel{position:absolute;left:6cqw;width:88cqw;top:26cqh;height:48cqh;box-sizing:border-box;background:#141412;padding:3.2cqw;overflow:hidden;border-radius:4px 10px 6px 8px;box-shadow:1px 1px 0 #0891B2}
.${p}-tag{margin:0 0 2cqw;font-family:"Consola",monospace;font-size:1.2cqw;letter-spacing:.1em;color:#A8A29E}
.${p}-flow{position:absolute;left:5%;top:36%;width:90%;height:7%}
.${p}-flow-bg{position:absolute;inset:0;background:#26261F;border-radius:2px 6px 3px 5px}
.${p}-fill{position:absolute;inset:0;background:#0891B2;transform:scaleX(0);transform-origin:left center;border-radius:2px 6px 3px 5px}
.${p}-node{position:absolute;top:28%;width:20%;height:22%;box-sizing:border-box;background:#141412;border:0.28cqw solid #0891B2;display:flex;align-items:center;justify-content:center;border-radius:3px 8px 5px 9px}
.${p}-node p{margin:0;font-family:"SimHei",sans-serif;font-size:2.1cqw;color:#A5F3FC;text-align:center}
${nodeCss}
.${p}-sketch{position:absolute;left:8%;right:8%;top:62%;height:10%;overflow:visible}
.${p}-sketch path{fill:none;stroke:#67E8F9;stroke-width:3;stroke-linecap:round}
.${p}-note{position:absolute;left:5%;right:5%;top:76%;margin:0;font-family:"SimHei",sans-serif;font-size:2.8cqw;color:#F6F6F2;text-align:center}`,
    html: `<div id="${p}-panel" class="clip ${p}-panel" data-start="0" data-duration="${duration}" data-track-index="4">
    <p class="${p}-tag">每个节点读状态、写状态</p>
    <div class="${p}-flow"><div class="${p}-flow-bg"></div><div id="${p}-fill" class="${p}-fill"></div></div>
    ${nodeHtml}
    <svg class="${p}-sketch" viewBox="0 0 240 36" preserveAspectRatio="none"><path id="${p}-draw" d="M4 22 C 48 6, 92 30, 138 12 S 208 30, 236 16" stroke-dasharray="260" stroke-dashoffset="260"></path></svg>
    <p class="${p}-note">像一条流水线，状态一路流过去</p>
  </div>`,
    motion: `tl.fromTo("#${p}-panel",{y:40,opacity:0,rotation:.6},{y:0,opacity:1,rotation:.2,duration:.65,ease:"power3.out"},1.15);
document.querySelectorAll(".${p}-node").forEach((n,i)=>{tl.fromTo(n,{scale:.7,opacity:0},{scale:1,opacity:1,duration:.35,ease:"back.out(1.6)"},2.1+i*.45)});
tl.fromTo("#${p}-fill",{scaleX:0},{scaleX:1,duration:${Math.min(3.4, Math.max(1.8, duration * 0.28)).toFixed(2)},ease:"power1.inOut"},2.3);
tl.fromTo("#${p}-draw",{strokeDashoffset:260},{strokeDashoffset:0,duration:1.1,ease:"power2.inOut"},2.6);
tl.fromTo(".${p}-note",{y:14,opacity:0},{y:0,opacity:1,duration:.45,ease:"power3.out"},${late(duration, 3.6)});`,
  };
}

function loopStage(p: string, items: string[], duration: number): Stage {
  const nodes = items.slice(0, 4).map((item) => shortLabel(item, 6));
  const nodeHtml = nodes.map((item, i) => `<div class="${p}-node ${p}-n${i + 1}"><p>${escapeHtml(item)}</p></div>`).join("");
  return {
    paper: true,
    css: `.${p}-panel{position:absolute;left:6cqw;width:88cqw;top:26cqh;height:48cqh;box-sizing:border-box;background:#141412;padding:3cqw;overflow:hidden;border-radius:5px 9px 4px 10px;box-shadow:1px 1px 0 #0891B2}
.${p}-tag{margin:0 0 1.6cqw;font-family:"Consola",monospace;font-size:1.2cqw;letter-spacing:.1em;color:#A8A29E}
.${p}-node{position:absolute;width:26%;height:24%;box-sizing:border-box;background:#26261F;border:0.28cqw solid #0891B2;display:flex;align-items:center;justify-content:center;border-radius:3px 8px 5px 9px}
.${p}-node p{margin:0;font-family:"SimHei",sans-serif;font-size:2.1cqw;color:#A5F3FC;text-align:center}
.${p}-n1{left:8%;top:16%}.${p}-n2{left:40%;top:16%}.${p}-n3{left:40%;top:52%}.${p}-n4{left:8%;top:52%}
.${p}-edge{position:absolute;background:#0891B2;height:0.22cqw;transform-origin:left center}
.${p}-ck{position:absolute;width:2.6cqw;height:2.6cqw;border-radius:50%;background:#67E8F9}
.${p}-pause{position:absolute;left:70%;top:56%;margin:0;font-family:"SimHei",sans-serif;font-size:2.2cqw;color:#67E8F9}
.${p}-note{position:absolute;left:5%;right:5%;top:84%;margin:0;font-family:"SimHei",sans-serif;font-size:2.6cqw;color:#F6F6F2;text-align:center}`,
    html: `<div id="${p}-panel" class="clip ${p}-panel" data-start="0" data-duration="${duration}" data-track-index="4">
    <p class="${p}-tag">图能成环 · 每步存检查点</p>
    ${nodeHtml}
    <div id="${p}-e1" class="${p}-edge" style="left:34%;top:26%;width:10%"></div>
    <div id="${p}-e2" class="${p}-edge" style="left:53%;top:36%;width:0.22cqw;height:18%;transform-origin:top center"></div>
    <div id="${p}-e3" class="${p}-edge" style="left:36%;top:62%;width:10%"></div>
    <div id="${p}-loop" class="${p}-edge" style="left:34%;top:38%;width:0.22cqw;height:20%;transform-origin:top center"></div>
    <div id="${p}-ck1" class="${p}-ck" style="left:36%;top:22%"></div>
    <div id="${p}-ck2" class="${p}-ck" style="left:50%;top:22%"></div>
    <p class="${p}-pause">能回头 · 能暂停</p>
    <p class="${p}-note">每走一步，留下一个检查点</p>
  </div>`,
    motion: `tl.fromTo("#${p}-panel",{y:40,opacity:0},{y:0,opacity:1,duration:.6,ease:"power3.out"},1.15);
document.querySelectorAll(".${p}-node").forEach((n,i)=>{tl.fromTo(n,{scale:.7,opacity:0},{scale:1,opacity:1,duration:.35,ease:"back.out(1.6)"},2.1+i*.42)});
tl.fromTo("#${p}-e1",{scaleX:0},{scaleX:1,duration:.32,ease:"power2.out"},2.6);
tl.fromTo("#${p}-e2",{scaleY:0},{scaleY:1,duration:.32,ease:"power2.out"},3.0);
tl.fromTo("#${p}-e3",{scaleX:0},{scaleX:1,duration:.32,ease:"power2.out"},3.4);
tl.fromTo("#${p}-loop",{scaleY:0},{scaleY:1,duration:.45,ease:"power2.inOut"},4.0);
tl.fromTo("#${p}-ck1",{scale:0,opacity:0},{scale:1,opacity:1,duration:.32,ease:"back.out(1.8)"},4.6);
tl.fromTo("#${p}-ck2",{scale:0,opacity:0},{scale:1,opacity:1,duration:.32,ease:"back.out(1.8)"},5.0);
tl.fromTo(".${p}-pause",{x:16,opacity:0},{x:0,opacity:1,duration:.4,ease:"power2.out"},5.5);
tl.fromTo(".${p}-note",{y:12,opacity:0},{y:0,opacity:1,duration:.45,ease:"power3.out"},${late(duration, 3.8)});`,
  };
}

function compareStage(p: string, items: string[], duration: number, band: string): Stage {
  const left = splitPair(items[0] ?? "之前");
  const right = splitPair(items[1] ?? "之后");
  return {
    paper: true,
    css: `.${p}-left,.${p}-right{position:absolute;width:40cqw;top:30cqh;box-sizing:border-box;padding:2.6cqw;border-radius:3px 9px 6px 8px}
.${p}-left{left:6cqw;background:#F6F6F2;border:0.22cqw solid #141412;box-shadow:1px 1px 0 #141412}
.${p}-right{right:6cqw;background:#A5F3FC;border:0.22cqw solid #0891B2;box-shadow:1px 1px 0 #155E75}
.${p}-left h3,.${p}-right h3{margin:0 0 1.2cqw;font-family:"SimHei",sans-serif;font-size:3.1cqw}
.${p}-left h3{color:#141412}.${p}-right h3{color:#155E75}
.${p}-tag{margin:0 0 1.4cqw;font-family:"Consola",monospace;font-size:1.4cqw;letter-spacing:.1em;color:#3D4F44}
.${p}-left p,.${p}-right p{margin:.6cqw 0;font-family:"SimHei",sans-serif;font-size:2.5cqw;line-height:1.3;color:#141412}
.${p}-right p{color:#155E75}
.${p}-vs{position:absolute;left:46cqw;top:48cqh;font-family:"Consola",monospace;font-size:3cqw;color:#3D4F44}
.${p}-rect{position:absolute;left:52cqw;top:28.4cqh;width:42cqw;height:38cqh;overflow:visible;pointer-events:none}
.${p}-rect path{fill:none;stroke:#0891B2;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.${p}-band{position:absolute;left:6cqw;right:6cqw;top:78cqh;box-sizing:border-box;background:#0891B2;padding:2.4cqw 3cqw;border-radius:3px 9px 5px 8px;box-shadow:1px 1px 0 #155E75}
.${p}-band p{margin:0;font-family:"SimHei",sans-serif;font-size:3.8cqw;letter-spacing:.03em;line-height:1.18;color:#fff;text-align:center}`,
    html: `<div id="${p}-left" class="clip ${p}-left" data-start="0" data-duration="${duration}" data-track-index="4">
    <h3>${escapeHtml(left.k)}</h3><p class="${p}-tag">BEFORE</p><p>${escapeHtml(left.v || left.k)}</p>
  </div>
  <div id="${p}-vs" class="clip ${p}-vs" data-start="0" data-duration="${duration}" data-track-index="5">VS</div>
  <div id="${p}-right" class="clip ${p}-right" data-start="0" data-duration="${duration}" data-track-index="6">
    <h3>${escapeHtml(right.k)}</h3><p class="${p}-tag">AFTER</p><p>${escapeHtml(right.v || right.k)}</p>
  </div>
  <div id="${p}-rect" class="clip ${p}-rect" data-start="0" data-duration="${duration}" data-track-index="7">
    <svg viewBox="0 0 160 140" preserveAspectRatio="none"><path id="${p}-draw" d="M8 14 C 6 6, 18 4, 152 8 S 156 126, 148 132 S 10 136, 6 128 S 10 18, 8 14" stroke-dasharray="420" stroke-dashoffset="420"></path></svg>
  </div>
  <div id="${p}-band" class="clip ${p}-band" data-start="0" data-duration="${duration}" data-track-index="8"><p>${escapeHtml(band)}</p></div>`,
    motion: `tl.fromTo("#${p}-left",{x:-34,opacity:0,rotation:-4},{x:0,opacity:1,rotation:-1.2,duration:.55,ease:"power2.out"},1.25);
tl.fromTo("#${p}-right",{x:34,opacity:0,rotation:4},{x:0,opacity:1,rotation:1.1,duration:.55,ease:"power2.out"},1.85);
tl.fromTo("#${p}-vs",{scale:.5,opacity:0},{scale:1,opacity:1,duration:.4,ease:"back.out(1.8)"},2.35);
tl.fromTo("#${p}-draw",{strokeDashoffset:420},{strokeDashoffset:0,duration:.9,ease:"power2.inOut"},2.6);
tl.fromTo("#${p}-band",{y:26,opacity:0},{y:0,opacity:1,duration:.5,ease:"power3.out"},${late(duration)});`,
  };
}

function principleStage(p: string, items: string[], duration: number): Stage {
  const rows = items.slice(0, 3);
  while (rows.length < 2) rows.push(takeawayFromText(rows[0] ?? "记住这一条"));
  const html = rows.map((item, i) => `<div id="${p}-r${i + 1}" class="clip ${p}-row ${p}-r${i + 1}" data-start="0" data-duration="${duration}" data-track-index="${5 + i}">
    <p><span class="n">${String(i + 1).padStart(2, "0")}</span>${escapeHtml(shortLabel(item, 16))}</p>
  </div>`).join("\n  ");
  const rowCss = rows.map((_, i) => `.${p}-r${i + 1}{top:${50 + i * 8}cqh}`).join("\n");
  const burst = Array.from({ length: 6 }, (_, i) => {
    const a = -40 + i * 16;
    return `<line x1="40" y1="40" x2="${40 + Math.round(28 * Math.cos((a * Math.PI) / 180))}" y2="${40 + Math.round(28 * Math.sin((a * Math.PI) / 180))}"/>`;
  }).join("");
  return {
    paper: false,
    css: `.${p}-kicker-clip{position:absolute;left:6cqw;top:16cqh;margin:0;font-family:"Consola",monospace;font-size:1.7cqw;letter-spacing:.18em;color:#67E8F9}
.${p}-row{position:absolute;left:6cqw;width:88cqw}
.${p}-row p{margin:0;font-family:"SimHei",sans-serif;font-size:3.4cqw;line-height:1.4;color:#F6F6F2}
.${p}-row .n{font-family:"Consola",monospace;color:#67E8F9;margin-right:2cqw}
${rowCss}
.${p}-burst{position:absolute;right:8cqw;top:18cqh;width:12cqw;height:12cqw;overflow:visible}
.${p}-burst line{stroke:#67E8F9;stroke-width:2.4;stroke-linecap:round;opacity:.85}
.${p}-line{position:absolute;left:6cqw;width:40cqw;top:76cqh;height:0.6cqw;background:#0891B2;transform-origin:left center}`,
    html: `${html}
  <div id="${p}-burst" class="clip ${p}-burst" data-start="0" data-duration="${duration}" data-track-index="8">
    <svg viewBox="0 0 80 80">${burst}</svg>
  </div>
  <div id="${p}-line" class="clip ${p}-line" data-start="0" data-duration="${duration}" data-track-index="9"></div>`,
    motion: `document.querySelectorAll(".${p}-row").forEach((n,i)=>{tl.fromTo(n,{x:-24,opacity:0},{x:0,opacity:1,duration:.5,ease:"power2.out"},2.1+i*.7)});
tl.fromTo("#${p}-burst",{scale:.4,opacity:0,rotation:-12},{scale:1,opacity:1,rotation:0,duration:.55,ease:"back.out(1.8)"},1.6);
tl.fromTo("#${p}-line",{scaleX:0},{scaleX:1,duration:.6,ease:"power2.out"},${Math.min(duration * 0.55, 5).toFixed(2)});`,
  };
}

function boundaryStage(p: string, items: string[], duration: number, band: string): Stage {
  const cards = items.slice(0, 3);
  while (cards.length < 2) cards.push("适用边界");
  const css = cards.map((_, i) => {
    const hot = i === cards.length - 1;
    return `.${p}-c${i + 1}{position:absolute;left:6cqw;width:88cqw;top:${28 + i * 14}cqh;box-sizing:border-box;padding:2.4cqw 3cqw;display:flex;align-items:baseline;justify-content:space-between;gap:2cqw;border-radius:${3 + i}px ${8 - i}px 5px 9px;border:0.22cqw solid ${hot ? "#0891B2" : "#141412"};background:${hot ? "#A5F3FC" : "#F6F6F2"};box-shadow:1px 1px 0 ${hot ? "#155E75" : "#141412"}}`;
  }).join("\n");
  const html = cards.map((item, i) => {
    const pair = splitPair(item);
    return `<div id="${p}-c${i + 1}" class="clip ${p}-c${i + 1}" data-start="0" data-duration="${duration}" data-track-index="${4 + i}">
    <span class="k">${escapeHtml(pair.k)}</span><span class="v${i === cards.length - 1 ? " hot" : ""}">${escapeHtml(pair.v || pair.k)}</span>
  </div>`;
  }).join("\n  ");
  const motion = cards.map((_, i) => {
    const rot = ((i % 2 === 0 ? -1 : 1) * (0.7 + i * 0.25)).toFixed(1);
    const ease = i === cards.length - 1 ? "back.out(1.7)" : "power2.out";
    return `tl.fromTo("#${p}-c${i + 1}",{x:-24,opacity:0,rotation:-2.4},{x:0,opacity:1,rotation:${rot},duration:.5,ease:"${ease}"},${(1.5 + i * 0.85).toFixed(2)});`;
  }).join("\n");
  return {
    paper: true,
    css: `${css}
.${p}-c${cards.length} .k, .${p}-c${cards.length} .v{position:relative}
.k{font-family:"SimHei",sans-serif;font-size:2.9cqw;color:#141412}
.v{font-family:"SimHei",sans-serif;font-size:2.5cqw;color:#3D4F44;text-align:right}
.v.hot{color:#155E75}
.${p}-oval{position:absolute;left:4cqw;width:92cqw;top:${26 + (cards.length - 1) * 14}cqh;height:16cqh;overflow:visible;pointer-events:none}
.${p}-oval path{fill:none;stroke:#0891B2;stroke-width:2.6;stroke-linecap:round}
.${p}-cta{position:absolute;left:6cqw;right:6cqw;top:80cqh;box-sizing:border-box;background:#0891B2;padding:2.6cqw 3cqw;border-radius:3px 9px 5px 8px;box-shadow:1px 1px 0 #155E75}
.${p}-cta p{margin:0;font-family:"SimHei",sans-serif;font-size:3.4cqw;line-height:1.25;color:#fff;text-align:center}`,
    html: `${html}
  <div id="${p}-oval" class="clip ${p}-oval" data-start="0" data-duration="${duration}" data-track-index="${4 + cards.length}">
    <svg viewBox="0 0 200 50" preserveAspectRatio="none"><path id="${p}-draw" d="M12 26 C 18 8, 70 4, 100 8 S 178 6, 190 22 S 170 46, 100 44 S 16 44, 12 26" stroke-dasharray="380" stroke-dashoffset="380"></path></svg>
  </div>
  <div id="${p}-cta" class="clip ${p}-cta" data-start="0" data-duration="${duration}" data-track-index="${5 + cards.length}"><p>${escapeHtml(band)}</p></div>`,
    motion: `${motion}
tl.fromTo("#${p}-draw",{strokeDashoffset:380},{strokeDashoffset:0,duration:.8,ease:"power2.inOut"},${(1.7 + cards.length * 0.85).toFixed(2)});
tl.fromTo("#${p}-cta",{y:26,opacity:0,rotation:-0.8},{y:0,opacity:1,rotation:-0.2,duration:.55,ease:"power3.out"},${late(duration)});`,
  };
}

function paperShell(p: string): string {
  return `#root{position:absolute;inset:0;width:1080px;height:1920px;overflow:hidden;container-type:size;color:#141412;background:#F6F6F2}
.${p}-bg{position:absolute;inset:0;background-color:#F6F6F2;background-image:repeating-linear-gradient(0deg,rgba(20,20,18,.045) 0 1px,transparent 1px 3px),linear-gradient(to right,rgba(20,20,18,.06) 1px,transparent 1px),linear-gradient(to bottom,rgba(20,20,18,.06) 1px,transparent 1px);background-size:100% 3px,4cqw 4cqw,4cqw 4cqw}
.${p}-grain{position:absolute;inset:0;opacity:.16;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.78' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.${p}-chrome{position:absolute;inset:0}
.${p}-hair{position:absolute;left:4cqw;right:4cqw;height:0.14cqw;background:#141412}
.${p}-hair-top{top:3cqw}.${p}-hair-bot{top:93cqh}`;
}

function inkShell(p: string): string {
  return `#root{position:absolute;inset:0;width:1080px;height:1920px;overflow:hidden;container-type:size;color:#F6F6F2;background:#141412}
.${p}-bg{position:absolute;inset:0;background:#141412}
.${p}-chrome{position:absolute;inset:0}`;
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

function takeaway(scene: VisualScene, plan: VisualPlan, index: number): string {
  if (index === plan.scenes.length - 1) {
    const repo = repositoryLabel(plan.repositoryUrl ?? "");
    const creator = plan.creatorName ?? "虾哥不加班";
    return repo ? `GitHub 搜索 ${repo} · 关注「${creator}」` : `去 GitHub 看源码 · 关注「${creator}」`;
  }
  if (scene.bullets?.length) return scene.bullets.at(-1)!;
  return takeawayFromText(scene.narration);
}

function takeawayFromText(text: string): string {
  return text.split(/[。！？]/u).map((item) => item.trim()).find(Boolean) ?? text;
}

function titleMarkup(title: string, p: string): string {
  const idx = Math.max(title.lastIndexOf("："), title.lastIndexOf("，"));
  if (idx > 0 && idx < title.length - 1) {
    return `${escapeHtml(title.slice(0, idx + 1))}<span class="${p}-hit"><i class="${p}-sweep"></i><em>${escapeHtml(title.slice(idx + 1))}</em></span>`;
  }
  const mid = Math.max(2, Math.floor(title.length * 0.45));
  return `${escapeHtml(title.slice(0, mid))}<span class="${p}-hit"><i class="${p}-sweep"></i><em>${escapeHtml(title.slice(mid))}</em></span>`;
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

function late(duration: number, bias = 3.2): string {
  return Math.max(duration * 0.62, duration - bias).toFixed(2);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}

function escapeJs(text: string): string {
  return text.replace(/[\\"\n\r]/gu, (char) => ({ "\\": "\\\\", "\"": "\\\"", "\n": "\\n", "\r": "\\r" })[char]!);
}
