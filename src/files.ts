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
    description: "递归查询工作区文件。统计数量时使用 mode=count，并尽量用 extensions 过滤，避免返回大清单。",
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
      const capped = files.slice(0, query.maxResults);
      return `${capped.join("\n")}${files.length > capped.length ? `\n… ${files.length - capped.length} more files` : ""}`;
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

  return () => {
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
    exclude: new Set(["node_modules", ...excluded].map(normalizeRelative)),
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
  if (typeof args !== "object" || args === null || !("path" in args)) return undefined;
  const value = (args as { path: unknown }).path;
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return value;
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
