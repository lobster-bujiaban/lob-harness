import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { readFile, stat } from "node:fs/promises";
import type { SessionEvent } from "./session.ts";

const MAX_SOURCE_BYTES = 32_768;
const MAX_RENDER_CHARS = 24_576;

export function sessionWorkspaceRoot(events: readonly SessionEvent[]): string | undefined {
  let root: string | undefined;
  for (const event of events) {
    if (event.type === "workspace_root") root = event.path;
  }
  return root;
}

export async function loadAgentInstructions(workspaceRoot: string): Promise<string> {
  const sources: { label: string; text: string }[] = [];
  const home = (process.env.DSH_HOME?.trim() || join(homedir(), ".dsh"));
  const global = await readOptional(join(home, "AGENTS.md"));
  if (global !== undefined) sources.push({ label: "~/.dsh/AGENTS.md", text: global });

  const projectRoot = await findProjectRoot(workspaceRoot);
  const seen = new Set<string>();
  for (const dir of directoriesFromTo(projectRoot, workspaceRoot)) {
    for (const name of ["AGENTS.md", "AGENTS.local.md"] as const) {
      const text = await readOptional(join(dir, name));
      if (text === undefined) continue;
      const key = text.trim();
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({ label: instructionLabel(dir, name, workspaceRoot, projectRoot), text });
    }
  }
  if (sources.length === 0) return "";
  const parts = [
    "The following workspace instructions may be relevant to your work. Use them as guidance when applicable. More specific instructions take precedence over broader ones.",
  ];
  for (const source of sources) {
    parts.push(`Instructions from: ${source.label}\n\n${source.text}`);
  }
  const rendered = parts.join("\n\n");
  return rendered.length > MAX_RENDER_CHARS
    ? `${rendered.slice(0, MAX_RENDER_CHARS)}\n\n(AGENTS.md truncated)`
    : rendered;
}

function instructionLabel(dir: string, name: string, workspaceRoot: string, projectRoot: string): string {
  if (resolve(dir) === resolve(workspaceRoot)) return name;
  const fromProject = relative(projectRoot, join(dir, name)).replaceAll("\\", "/");
  return fromProject.length > 0 ? fromProject : name;
}

async function findProjectRoot(workspaceRoot: string): Promise<string> {
  let current = resolve(workspaceRoot);
  while (true) {
    try {
      await stat(join(current, ".git"));
      return current;
    } catch {
      const parent = resolve(current, "..");
      if (parent === current) return resolve(workspaceRoot);
      current = parent;
    }
  }
}

function directoriesFromTo(from: string, to: string): string[] {
  const start = resolve(from);
  const end = resolve(to);
  const rel = relative(start, end);
  if (rel.startsWith("..") || isAbsolute(rel)) return [end];
  const dirs = [start];
  if (rel === "") return dirs;
  let current = start;
  for (const part of rel.split(/[\\/]/u).filter(Boolean)) {
    current = join(current, part);
    dirs.push(current);
  }
  return dirs;
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    const bytes = await readFile(path);
    if (bytes.byteLength > MAX_SOURCE_BYTES) {
      return `${bytes.subarray(0, MAX_SOURCE_BYTES).toString("utf8")}\n\n(truncated)`;
    }
    const text = bytes.toString("utf8").trim();
    return text.length === 0 ? undefined : text;
  } catch {
    return undefined;
  }
}
