import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { FsProvider } from "./fs-service.ts";
import {
  ToolError,
  type ToolExecution,
  type ToolRegistry,
} from "./tools.ts";

export function installReadFile(
  registry: ToolRegistry,
  options: { root: string; provider: FsProvider; maxBytes?: number },
): () => void {
  const provider = options.provider;
  const maxBytes = options.maxBytes ?? 1_048_576;
  const configuredRoot = resolve(options.root);
  const canonicalRoot = provider.canonicalize(configuredRoot);
  const admitted = new WeakMap<Readonly<ToolExecution>, string>();
  const admittedGrep = new WeakMap<Readonly<ToolExecution>, GrepAdmission>();

  const disposeReadPolicy = registry.onPreExecute(async (execution, next) => {
    if (execution.name !== "read_file") return next();
    const requested = readPathArgument(execution.args);
    if (requested === undefined) {
      return { kind: "deny", reason: "read_file requires a non-empty path" };
    }
    const candidate = isAbsolute(requested) ? resolve(requested) : resolve(configuredRoot, requested);
    if (!isWithin(configuredRoot, candidate)) {
      return { kind: "deny", reason: "read_file path is outside the allowed root" };
    }
    try {
      const [root, target] = await Promise.all([
        canonicalRoot,
        provider.canonicalize(candidate),
      ]);
      if (!isWithin(root, target)) {
        return { kind: "deny", reason: "read_file path resolves outside the allowed root" };
      }
      admitted.set(execution, target);
    } catch (error) {
      // Provider errors remain provider-owned structured results, not policy denials.
      if (isMissing(error)) throw new ToolError("read_file target does not exist", "FS_NOT_FOUND", {
        cause: error,
      });
      throw error;
    }
    return next();
  });

  const disposeWritePolicy = registry.onPreExecute(async (execution, next) => {
    if (execution.name !== "write_file") return next();
    const requested = readPathArgument(execution.args);
    if (requested === undefined) {
      return { kind: "deny", reason: "write_file requires a non-empty path" };
    }
    if (readContentArgument(execution.args) === undefined) {
      return { kind: "deny", reason: "write_file requires a string content" };
    }
    const candidate = isAbsolute(requested) ? resolve(requested) : resolve(configuredRoot, requested);
    if (!isWithin(configuredRoot, candidate)) {
      return { kind: "deny", reason: "write_file path is outside the allowed root" };
    }
    const target = await resolveWriteTarget(provider, canonicalRoot, candidate);
    if (typeof target !== "string") return target;
    admitted.set(execution, target);
    return next();
  });

  const disposeReadFile = registry.register({
    name: "read_file",
    description: "读取允许根目录内的 UTF-8 文本文件。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对允许根目录的文件路径" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    executionMode: { kind: "parallel" },
    async execute(_args, context) {
      const target = admitted.get(context.execution);
      if (target === undefined) {
        throw new ToolError("read_file path was not admitted by policy", "FS_NOT_ADMITTED");
      }
      const metadata = await provider.stat(target);
      if (metadata.kind !== "file") {
        throw new ToolError("read_file target is not a regular file", "FS_NOT_FILE");
      }
      if (metadata.size > maxBytes) {
        throw new ToolError(`read_file target exceeds ${maxBytes} bytes`, "FS_TOO_LARGE");
      }
      return provider.readText(target, context.signal);
    },
  });

  const disposeListFiles = registry.register({
    name: "list_files",
    description: "列出工作区文件。默认跳过 node_modules、dist、target、build、coverage。未过滤扩展名时先列出当前目录的子目录。看仓库结构用较小 maxResults；搜符号用 grep，不要扫整仓。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对工作区根目录的目录，默认为根目录" },
        extensions: {
          type: "array",
          items: { type: "string" },
          description: "扩展名过滤，例如 [\".pdf\"]；不区分大小写",
        },
        exclude: {
          type: "array",
          items: { type: "string" },
          description: "排除的相对路径或目录名，例如 [\"preview\", \"v2/out\"]",
        },
        excludeHidden: { type: "boolean", description: "是否排除隐藏文件和目录，默认 true" },
        mode: { type: "string", enum: ["list", "count"], description: "返回文件列表或仅返回数量" },
        maxResults: { type: "integer", minimum: 1, maximum: 5000, description: "list 模式最大返回条数，默认 1000" },
      },
      additionalProperties: false,
    },
    executionMode: { kind: "parallel" },
    async execute(args, context) {
      const query = parseListFilesArgs(args);
      const requested = query.path;
      const candidate = resolve(configuredRoot, requested || ".");
      if (!isWithin(configuredRoot, candidate)) {
        throw new ToolError("list_files path is outside the allowed root", "FS_OUTSIDE_ROOT");
      }
      let canonical: string;
      try {
        canonical = await provider.canonicalize(candidate);
      } catch (error) {
        if (isMissing(error)) throw new ToolError("list_files target does not exist", "FS_NOT_FOUND");
        throw error;
      }
      const root = await canonicalRoot;
      if (!isWithin(root, canonical)) {
        throw new ToolError("list_files path resolves outside the allowed root", "FS_OUTSIDE_ROOT");
      }
      if ((await provider.stat(canonical)).kind !== "directory") {
        throw new ToolError("list_files target is not a directory", "FS_NOT_DIRECTORY");
      }
      const files = (await walkFiles(provider, canonical, context.signal, query))
        .filter((path) => query.extensions.length === 0
          || query.extensions.includes(extname(path).toLowerCase()))
        .sort((left, right) => left.localeCompare(right));
      if (query.mode === "count") {
        return JSON.stringify({ count: files.length, path: requested || ".", extensions: query.extensions });
      }
      const directories = query.extensions.length === 0
        ? await listImmediateDirectories(provider, canonical, context.signal, query)
        : [];
      const listing = [...directories, ...files];
      const capped = listing.slice(0, query.maxResults);
      const omitted = listing.length - capped.length;
      return `${capped.join("\n")}${omitted > 0 ? `\n… ${omitted} more files` : ""}`;
    },
  });

  const disposeWriteFile = registry.register({
    name: "write_file",
    description: "在允许根目录内创建或覆盖 UTF-8 文本文件。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对允许根目录的文件路径" },
        content: { type: "string", description: "要写入的 UTF-8 文本，可以为空" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    executionMode: { kind: "exclusive" },
    async execute(args, context) {
      const target = admitted.get(context.execution);
      if (target === undefined) {
        throw new ToolError("write_file path was not admitted by policy", "FS_NOT_ADMITTED");
      }
      const content = readContentArgument(args);
      if (content === undefined) {
        throw new ToolError("write_file requires a string content", "INVALID_ARGUMENT");
      }
      const bytes = new TextEncoder().encode(content).byteLength;
      if (bytes > maxBytes) {
        throw new ToolError(`write_file content exceeds ${maxBytes} bytes`, "FS_TOO_LARGE");
      }
      await provider.writeText(target, content, context.signal);
      const root = await canonicalRoot;
      const displayed = relative(root, target).replaceAll("\\", "/") || basename(target);
      return `wrote ${displayed} (${bytes} bytes)`;
    },
  });

  const disposeGrepPolicy = registry.onPreExecute(async (execution, next) => {
    if (execution.name !== "grep") return next();
    const pattern = readStringArgument(execution.args, "pattern");
    if (pattern === undefined) {
      return { kind: "deny", reason: "grep requires a non-empty pattern" };
    }
    try {
      new RegExp(pattern);
    } catch {
      return { kind: "deny", reason: "grep pattern is not a valid regular expression" };
    }
    const include = readStringArgument(execution.args, "include");
    const maxMatches = readMaxMatches(execution.args);
    if (maxMatches === "invalid") {
      return { kind: "deny", reason: "grep maxMatches must be an integer between 1 and 500" };
    }
    const requested = readPathArgument(execution.args) ?? ".";
    const candidate = isAbsolute(requested) ? resolve(requested) : resolve(configuredRoot, requested);
    if (!isWithin(configuredRoot, candidate)) {
      return { kind: "deny", reason: "grep path is outside the allowed root" };
    }
    try {
      const [root, target] = await Promise.all([
        canonicalRoot,
        provider.canonicalize(candidate),
      ]);
      if (!isWithin(root, target)) {
        return { kind: "deny", reason: "grep path resolves outside the allowed root" };
      }
      const kind = (await provider.stat(target)).kind;
      if (kind !== "file" && kind !== "directory") {
        return { kind: "deny", reason: "grep path must be a file or directory" };
      }
      admittedGrep.set(execution, {
        target,
        kind,
        pattern,
        include,
        maxMatches: maxMatches ?? 80,
      });
    } catch (error) {
      if (isMissing(error)) throw new ToolError("grep target does not exist", "FS_NOT_FOUND", { cause: error });
      throw error;
    }
    return next();
  });

  const disposeGrep = registry.register({
    name: "grep",
    description: "在工作区内用正则搜索文件内容。HTTP 5xx 或接口路径应先 grep 服务端实现，不要用 bash grep，也不要用 list_files 扫整仓。",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "JavaScript 正则，搜索文件内容" },
        path: { type: "string", description: "相对工作区的文件或目录，默认整个工作区" },
        include: { type: "string", description: "文件名 glob，例如 *.java 或 *ServiceImpl.java" },
        maxMatches: { type: "integer", description: "最大匹配条数，默认 80，最大 500" },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    executionMode: { kind: "parallel" },
    timeoutMs: 30_000,
    async execute(_args, context) {
      const call = admittedGrep.get(context.execution);
      if (call === undefined) {
        throw new ToolError("grep path was not admitted by policy", "FS_NOT_ADMITTED");
      }
      const root = await canonicalRoot;
      const regex = new RegExp(call.pattern);
      const files = call.kind === "file"
        ? [call.target]
        : (await walkFiles(provider, call.target, context.signal, {
          path: ".",
          extensions: [],
          exclude: defaultExcludeSet(),
          excludeHidden: true,
          mode: "list",
          maxResults: 5000,
        })).map((relativePath) => join(call.target, relativePath));
      const matches: string[] = [];
      let extra = 0;
      for (const file of files) {
        context.signal.throwIfAborted();
        const relativePath = relative(root, file).replaceAll("\\", "/") || basename(file);
        if (!matchesInclude(relativePath, call.include)) continue;
        let text: string;
        try {
          const metadata = await provider.stat(file);
          if (metadata.kind !== "file" || metadata.size > maxBytes) continue;
          text = await provider.readText(file, context.signal);
        } catch (error) {
          if (isToolErrorCode(error, "FS_INVALID_UTF8")) continue;
          throw error;
        }
        const lines = text.split(/\r?\n/u);
        for (let index = 0; index < lines.length; index++) {
          const line = lines[index];
          if (line === undefined || !regex.test(line)) continue;
          if (matches.length >= call.maxMatches) {
            extra++;
            continue;
          }
          const preview = line.length > 240 ? `${line.slice(0, 240)}…` : line;
          matches.push(`${relativePath}:${index + 1}:${preview}`);
        }
      }
      if (matches.length === 0) return "No matches found";
      return extra > 0 ? `${matches.join("\n")}\n… ${extra} more matches` : matches.join("\n");
    },
  });

  return () => {
    disposeGrep();
    disposeGrepPolicy();
    disposeWriteFile();
    disposeListFiles();
    disposeReadFile();
    disposeWritePolicy();
    disposeReadPolicy();
  };
}

type ListFilesQuery = {
  path: string;
  extensions: string[];
  exclude: Set<string>;
  excludeHidden: boolean;
  mode: "list" | "count";
  maxResults: number;
};

type GrepAdmission = {
  target: string;
  kind: "file" | "directory";
  pattern: string;
  include: string | undefined;
  maxMatches: number;
};

const DEFAULT_LIST_EXCLUDES = ["node_modules", "dist", "target", "build", "coverage"] as const;

function defaultExcludeSet(): Set<string> {
  return new Set(DEFAULT_LIST_EXCLUDES);
}

function parseListFilesArgs(args: unknown): ListFilesQuery {
  const value = typeof args === "object" && args !== null ? args as Record<string, unknown> : {};
  const path = typeof value.path === "string" ? value.path.trim() : ".";
  const extensions = stringArray(value.extensions, "extensions").map((item) =>
    (item.startsWith(".") ? item : `.${item}`).toLowerCase());
  const excluded = stringArray(value.exclude, "exclude");
  for (const item of excluded) {
    if (isAbsolute(item) || item.split(/[\\/]/u).includes("..")) {
      throw new ToolError("list_files exclude must stay within the target directory", "INVALID_ARGUMENT");
    }
  }
  const mode = value.mode ?? "list";
  if (mode !== "list" && mode !== "count") {
    throw new ToolError("list_files mode must be list or count", "INVALID_ARGUMENT");
  }
  const maxResults = value.maxResults ?? 1000;
  if (!Number.isInteger(maxResults) || Number(maxResults) < 1 || Number(maxResults) > 5000) {
    throw new ToolError("list_files maxResults must be an integer between 1 and 5000", "INVALID_ARGUMENT");
  }
  if (value.excludeHidden !== undefined && typeof value.excludeHidden !== "boolean") {
    throw new ToolError("list_files excludeHidden must be boolean", "INVALID_ARGUMENT");
  }
  return {
    path,
    extensions: [...new Set(extensions)],
    exclude: new Set([...DEFAULT_LIST_EXCLUDES, ...excluded].map(normalizeRelative)),
    excludeHidden: value.excludeHidden !== false,
    mode,
    maxResults: Number(maxResults),
  };
}

async function walkFiles(provider: FsProvider, root: string, signal: AbortSignal, query: ListFilesQuery): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string, prefix: string): Promise<void> {
    signal.throwIfAborted();
    const entries = await provider.readDirectory(directory, signal);
    for (const entry of entries) {
      signal.throwIfAborted();
      const path = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (isExcluded(path, entry.name, query)) continue;
      if (entry.kind === "directory") await visit(join(directory, entry.name), path);
      else if (entry.kind === "file") files.push(path);
    }
  }
  await visit(root, "");
  return files;
}

async function listImmediateDirectories(
  provider: FsProvider,
  root: string,
  signal: AbortSignal,
  query: ListFilesQuery,
): Promise<string[]> {
  const directories: string[] = [];
  for (const entry of await provider.readDirectory(root, signal)) {
    signal.throwIfAborted();
    if (entry.kind !== "directory" || isExcluded(entry.name, entry.name, query)) continue;
    directories.push(`${entry.name}/`);
  }
  directories.sort((left, right) => left.localeCompare(right));
  return directories;
}

async function resolveWriteTarget(
  provider: FsProvider,
  canonicalRoot: Promise<string>,
  candidate: string,
): Promise<string | { kind: "deny"; reason: string }> {
  const root = await canonicalRoot;
  try {
    const target = await provider.canonicalize(candidate);
    if (!isWithin(root, target)) {
      return { kind: "deny", reason: "write_file path resolves outside the allowed root" };
    }
    return target;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const parts: string[] = [];
  let current = candidate;
  while (true) {
    const parent = dirname(current);
    parts.unshift(basename(current));
    if (parent === current) {
      throw new ToolError("write_file target does not exist", "FS_NOT_FOUND");
    }
    try {
      const ancestor = await provider.canonicalize(parent);
      if (!isWithin(root, ancestor)) {
        return { kind: "deny", reason: "write_file path resolves outside the allowed root" };
      }
      return join(ancestor, ...parts);
    } catch (error) {
      if (!isMissing(error)) throw error;
      current = parent;
    }
  }
}

function isExcluded(path: string, name: string, query: ListFilesQuery): boolean {
  if (query.excludeHidden && name.startsWith(".")) return true;
  const normalized = normalizeRelative(path);
  return [...query.exclude].some((excluded) =>
    normalized === excluded || normalized.startsWith(`${excluded}/`) || name === excluded);
}

function stringArray(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new ToolError(`list_files ${name} must be an array of non-empty strings`, "INVALID_ARGUMENT");
  }
  return value.map((item) => (item as string).trim());
}

function normalizeRelative(path: string): string {
  return path.replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/\/+$/u, "");
}

function readPathArgument(args: unknown): string | undefined {
  return readStringArgument(args, "path");
}

function readStringArgument(args: unknown, name: string): string | undefined {
  if (typeof args !== "object" || args === null || !(name in args)) return undefined;
  const value = (args as Record<string, unknown>)[name];
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return name === "pattern" ? value : value.trim();
}

function readMaxMatches(args: unknown): number | undefined | "invalid" {
  if (typeof args !== "object" || args === null || !("maxMatches" in args)) return undefined;
  const value = (args as { maxMatches?: unknown }).maxMatches;
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 500) return "invalid";
  return Number(value);
}

function matchesInclude(path: string, include: string | undefined): boolean {
  if (include === undefined) return true;
  const name = basename(path);
  const escaped = include.replace(/[.+^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, ".*").replace(/\?/gu, ".");
  return new RegExp(`^${escaped}$`, "u").test(name);
}

function isToolErrorCode(error: unknown, code: string): boolean {
  return error instanceof ToolError && error.code === code;
}

function readContentArgument(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null || !("content" in args)) return undefined;
  const value = (args as { content: unknown }).content;
  return typeof value === "string" ? value : undefined;
}

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}
