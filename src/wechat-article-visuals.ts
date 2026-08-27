import { Resvg } from "@resvg/resvg-js";

type Item = { title: string; text: string };
type Comparison = { beforeTitle: string; before: string[]; afterTitle: string; after: string[] };
export type VisualPng = { file: string; png: Buffer; dataUrl: string };

const WIDTH = 652;
const SCALE = 2;
const FONT = "PingFang SC, Hiragino Sans GB, Heiti SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif";
const NAVY = "#172f5f";
const ORANGE = "#f15b36";
const INK = "#172033";
const MUTED = "#5c6573";

export function renderArticleVisuals(input: { journey: Item[]; steps: Item[]; comparison: Comparison }): VisualPng[] {
  return [
    raster("journey.png", journeySvg(input.journey)),
    raster("flow.png", flowSvg(input.steps)),
    raster("compare.png", compareSvg(input.comparison)),
  ];
}

function raster(file: string, svg: string): VisualPng {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH * SCALE },
    font: { loadSystemFonts: true, defaultFontFamily: "PingFang SC" },
  });
  const png = Buffer.from(resvg.render().asPng());
  return { file, png, dataUrl: `data:image/png;base64,${png.toString("base64")}` };
}

function journeySvg(items: Item[]): string {
  return spineSvg(items, { lastAccent: true, indexStyle: "number" });
}

function flowSvg(steps: Item[]): string {
  return spineSvg(steps, { lastAccent: false, indexStyle: "pad" });
}

function spineSvg(items: Item[], options: { lastAccent: boolean; indexStyle: "number" | "pad" }): string {
  const padX = 28;
  const padY = 30;
  const spineX = 42;
  const textX = 74;
  const textW = WIDTH - padX - textX;
  type Row = { y: number; cy: number; title: string[]; body: string[]; height: number; fill: string; label: string };
  const rows: Row[] = [];
  let y = padY;
  for (const [index, item] of items.entries()) {
    const title = wrap(item.title, textW, 17);
    const body = wrap(item.text, textW, 14);
    const height = title.length * 26 + 8 + body.length * 24;
    const fill = options.lastAccent && index === items.length - 1 ? ORANGE : NAVY;
    const label = options.indexStyle === "pad" ? String(index + 1).padStart(2, "0") : String(index + 1);
    rows.push({ y, cy: y + 12, title, body, height, fill, label });
    y += height + (index === items.length - 1 ? 0 : 28);
  }
  const height = y + padY;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const spine = first === undefined || last === undefined
    ? ""
    : `<line x1="${spineX}" y1="${first.cy}" x2="${spineX}" y2="${last.cy}" stroke="#d3d9e4" stroke-width="2"/>`;
  const body = rows.map((row, index) => {
    const next = rows[index + 1];
    const tick = next === undefined
      ? ""
      : `<path d="M${spineX - 4.5} ${row.y + row.height + 10} L${spineX} ${row.y + row.height + 16} L${spineX + 4.5} ${row.y + row.height + 10}" fill="none" stroke="${ORANGE}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
    return `${circle(spineX, row.cy, 13, row.fill)}${svgText(row.label, spineX, row.cy + 4, row.label.length > 1 ? 10 : 13, "#ffffff", "text-anchor=\"middle\" font-weight=\"700\"")}${tspan(row.title, textX, row.y + 16, 17, 26, INK, "font-weight=\"700\"")}${tspan(row.body, textX, row.y + 16 + row.title.length * 26 + 6, 14, 24, MUTED)}${tick}`;
  }).join("");
  return svgFrame(height, spine + body);
}

function compareSvg(plan: Comparison): string {
  const gap = 18;
  const colW = (WIDTH - gap) / 2;
  const pad = 22;
  const textW = colW - pad * 2 - 22;
  const column = (title: string, values: string[], accent: string, ink: string, x: number, fill: string) => {
    const heading = wrap(title, colW - pad * 2, 18);
    const lines = values.map((value) => wrap(value, textW, 14));
    let inner = pad + 10;
    const parts = [
      `<rect x="${x}" y="0" width="${colW}" height="4" fill="${accent}"/>`,
      tspan(heading, x + pad, inner + 16, 18, 26, accent, "font-weight=\"700\""),
    ];
    inner += heading.length * 26 + 14;
    for (const line of lines) {
      parts.push(`<rect x="${x + pad}" y="${inner + 3}" width="7" height="7" fill="${accent}"/>`);
      parts.push(tspan(line, x + pad + 18, inner + 14, 14, 23, ink));
      inner += line.length * 23 + 12;
    }
    return { height: inner + pad, parts: parts.join(""), fill, accent };
  };
  const left = column(plan.beforeTitle, plan.before, "#7b8494", "#4d5563", 0, "#f4f5f8");
  const right = column(plan.afterTitle, plan.after, ORANGE, INK, colW + gap, "#fff6f2");
  const height = Math.max(left.height, right.height, 140);
  return svgFrame(height, `<rect x="0" y="0" width="${colW}" height="${height}" fill="${left.fill}"/><rect x="${colW + gap}" y="0" width="${colW}" height="${height}" fill="${right.fill}"/>${left.parts}${right.parts}`, false);
}

function svgFrame(height: number, inner: string, painted = true): string {
  const bg = painted
    ? `<defs><linearGradient id="wash" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f8fb"/><stop offset="1" stop-color="#eef2f7"/></linearGradient></defs><rect width="${WIDTH}" height="${height}" fill="url(#wash)"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">${bg}${inner}</svg>`;
}

function wrap(text: string, maxWidth: number, fontSize: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of [...text]) {
    if (line.length > 0 && measure(line + ch, fontSize) > maxWidth) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.length === 0 ? [""] : lines;
}

function measure(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of [...text]) width += /[\u0000-\u00ff]/u.test(ch) ? fontSize * 0.56 : fontSize;
  return width;
}

function tspan(lines: string[], x: number, y: number, size: number, leading: number, fill: string, extra = ""): string {
  return lines.map((line, index) => svgText(line, x, y + index * leading, size, fill, extra)).join("");
}

function svgText(value: string, x: number, y: number, size: number, fill: string, extra = ""): string {
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-family="${FONT}" ${extra}>${escapeXml(value)}</text>`;
}

function circle(cx: number, cy: number, r: number, fill: string): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
