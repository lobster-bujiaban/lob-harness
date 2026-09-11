import { mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { Context, Service } from "@deepseek-ai/cordis";
import { ToolError } from "./tools.ts";
import { throwIfAborted } from "./errors.ts";

export type FsEntry = { name: string; kind: "file" | "directory" | "other" };
export type FsStat = { kind: "file" | "directory" | "other"; size: number };

export interface FsProvider {
  canonicalize(path: string): Promise<string>;
  stat(path: string): Promise<FsStat>;
  readText(path: string, signal: AbortSignal): Promise<string>;
  readDirectory(path: string, signal: AbortSignal): Promise<FsEntry[]>;
  writeText(path: string, content: string, signal: AbortSignal): Promise<void>;
}

export class LocalFsProvider implements FsProvider {
  canonicalize(path: string): Promise<string> { return realpath(path); }

  async stat(path: string): Promise<FsStat> {
    const value = await stat(path);
    return {
      kind: value.isFile() ? "file" : value.isDirectory() ? "directory" : "other",
      size: value.size,
    };
  }

  async readText(path: string, signal: AbortSignal): Promise<string> {
    const bytes = await readFile(path, { signal });
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      throw new ToolError("read_file target is not valid UTF-8", "FS_INVALID_UTF8", { cause: error });
    }
  }

  async readDirectory(path: string, signal: AbortSignal): Promise<FsEntry[]> {
    signal.throwIfAborted();
    return (await readdir(path, { withFileTypes: true })).map((entry) => ({
      name: entry.name,
      kind: entry.isFile() ? "file" : entry.isDirectory() ? "directory" : "other",
    }));
  }

  async writeText(path: string, content: string, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await mkdir(dirname(path), { recursive: true });
    try {
      const existing = await this.stat(path);
      if (existing.kind !== "file") {
        throw new ToolError("write_file target is not a regular file", "FS_NOT_FILE");
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, { encoding: "utf8", flag: "wx", signal });
      await rename(temporary, path);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}

declare module "@deepseek-ai/cordis" {
  interface Context { fs: FsService }
}

export class FsService extends Service implements FsProvider {
  constructor(ctx: Context, private readonly provider: FsProvider) { super(ctx, "fs"); }
  canonicalize(path: string): Promise<string> { return this.provider.canonicalize(path); }
  stat(path: string): Promise<FsStat> { return this.provider.stat(path); }
  readText(path: string, signal: AbortSignal): Promise<string> { return this.provider.readText(path, signal); }
  readDirectory(path: string, signal: AbortSignal): Promise<FsEntry[]> {
    return this.provider.readDirectory(path, signal);
  }
  writeText(path: string, content: string, signal: AbortSignal): Promise<void> {
    return this.provider.writeText(path, content, signal);
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}
