import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { installReadFile } from "../src/files.ts";
import { LocalFsProvider } from "../src/fs-service.ts";
import type { FsProvider } from "../src/fs-service.ts";
import { ToolRegistry } from "../src/tools.ts";

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "tiny-harness-files-"));
  const root = join(base, "workspace");
  const outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(root, "inside.txt"), "允许读取", "utf8");
  await writeFile(join(outside, "secret.txt"), "不应读取", "utf8");
  const registry = new ToolRegistry();
  installReadFile(registry, { root, provider: new LocalFsProvider() });
  return { base, root, outside, registry };
}

function expectedRead(displayPath: string, text: string, offset = 1, limit = 2000): string {
  const lines = text.split(/\r?\n/u);
  const totalLines = text.length === 0 ? 0 : lines.length;
  if (totalLines === 0) {
    return `<path>${displayPath}</path>\n<type>file</type>\n<content>\n(End of file - total 0 lines)\n</content>`;
  }
  const selected = lines.slice(offset - 1, offset - 1 + limit);
  const endLine = offset + selected.length - 1;
  const footer = endLine < totalLines
    ? `(Showing lines ${offset}-${endLine} of ${totalLines}. Use offset=${endLine + 1} to continue.)`
    : `(End of file - total ${totalLines} lines)`;
  const body = selected.map((line, index) => `${offset + index}: ${line}`).join("\n");
  return `<path>${displayPath}</path>\n<type>file</type>\n<content>\n${body}\n\n${footer}\n</content>`;
}

test("read_file 读取允许根目录内的 UTF-8 文件", async () => {
  const { registry } = await fixture();

  await expect(registry.execute(
    "read_file",
    { path: "inside.txt" },
    new AbortController().signal,
    "read-1",
  )).resolves.toEqual({ output: expectedRead("inside.txt", "允许读取"), isError: false });
});

test("read_file 接受 file_path，并按 offset/limit 返回窗口", async () => {
  const { root, registry } = await fixture();
  await writeFile(join(root, "window.txt"), ["a", "b", "c", "d"].join("\n"), "utf8");

  await expect(registry.execute(
    "read_file",
    { file_path: "window.txt", offset: 2, limit: 2 },
    new AbortController().signal,
  )).resolves.toEqual({
    output: expectedRead("window.txt", ["a", "b", "c", "d"].join("\n"), 2, 2),
    isError: false,
  });

  const invalid = await registry.execute(
    "read_file",
    { path: "window.txt", offset: 0 },
    new AbortController().signal,
  );
  expect(invalid).toMatchObject({ isError: true, error: { code: "DENIED" } });
});

test("read_file 策略拒绝 ../、根外绝对路径和符号链接逃逸", async () => {
  const { root, outside, registry } = await fixture();
  await symlink(join(outside, "secret.txt"), join(root, "escape.txt"));

  for (const path of ["../outside/secret.txt", join(outside, "secret.txt"), "escape.txt"]) {
    const result = await registry.execute(
      "read_file",
      { path },
      new AbortController().signal,
    );
    expect(result).toMatchObject({ isError: true, error: { code: "DENIED" } });
    expect(result.output).toContain("outside the allowed root");
  }
});

test("read_file 将不存在、目录和无效 UTF-8 规范化为独立错误码", async () => {
  const { root, registry } = await fixture();
  await mkdir(join(root, "folder"));
  await writeFile(join(root, "binary.txt"), Uint8Array.from([0xc3, 0x28]));

  const cases = [
    { path: "missing.txt", code: "FS_NOT_FOUND" },
    { path: "folder", code: "FS_NOT_FILE" },
    { path: "binary.txt", code: "FS_INVALID_UTF8" },
  ];
  for (const item of cases) {
    const result = await registry.execute(
      "read_file",
      { path: item.path },
      new AbortController().signal,
    );
    expect(result).toMatchObject({ isError: true, error: { code: item.code } });
  }
});

test("卸载 read_file 同时移除工具和路径策略", async () => {
  const base = await mkdtemp(join(tmpdir(), "tiny-harness-files-dispose-"));
  const registry = new ToolRegistry();
  const dispose = installReadFile(registry, { root: base, provider: new LocalFsProvider() });
  expect(registry.get("read_file")).toBeDefined();
  expect(registry.get("write_file")).toBeDefined();
  expect(registry.get("edit")).toBeDefined();
  expect(registry.get("grep")).toBeDefined();

  dispose();
  dispose();

  expect(registry.get("read_file")).toBeUndefined();
  expect(registry.get("write_file")).toBeUndefined();
  expect(registry.get("edit")).toBeUndefined();
  expect(registry.get("grep")).toBeUndefined();
  expect(await registry.execute("other", {}, new AbortController().signal))
    .toMatchObject({ isError: true, error: { code: "UNKNOWN_TOOL" } });
});

test("list_files 支持扩展名过滤、排除目录和 count 模式", async () => {
  const { root, registry } = await fixture();
  await mkdir(join(root, "resumes"));
  await mkdir(join(root, "preview"));
  await mkdir(join(root, ".cache"));
  await writeFile(join(root, "resumes", "one.pdf"), "one", "utf8");
  await writeFile(join(root, "resumes", "two.PDF"), "two", "utf8");
  await writeFile(join(root, "resumes", "note.txt"), "note", "utf8");
  await writeFile(join(root, "preview", "duplicate.pdf"), "duplicate", "utf8");
  await writeFile(join(root, ".cache", "hidden.pdf"), "hidden", "utf8");

  const counted = await registry.execute("list_files", {
    extensions: ["pdf"],
    exclude: ["preview"],
    mode: "count",
  }, new AbortController().signal);
  expect(counted).toEqual({
    output: JSON.stringify({ count: 2, path: ".", extensions: [".pdf"] }),
    isError: false,
  });

  const listed = await registry.execute("list_files", {
    path: "resumes",
    extensions: [".pdf"],
    mode: "list",
    maxResults: 1,
  }, new AbortController().signal);
  expect(listed.output).toContain("one.pdf");
  expect(listed.output).toContain("… 1 more files");
});

test("list_files 默认跳过 dist 并先列出子目录", async () => {
  const { root, registry } = await fixture();
  await mkdir(join(root, "dmp-web"));
  await mkdir(join(root, "dist", "assets"), { recursive: true });
  await writeFile(join(root, "dmp-web", "App.java"), "class App {}", "utf8");
  await writeFile(join(root, "dist", "assets", "index.js"), "bundle", "utf8");

  const listed = await registry.execute("list_files", { maxResults: 20 }, new AbortController().signal);
  expect(listed.isError).toBe(false);
  expect(listed.output).toContain("dmp-web/");
  expect(listed.output).toContain("dmp-web/App.java");
  expect(listed.output).not.toContain("dist/");
  expect(listed.output).not.toContain("index.js");
});

test("grep 在工作区内按正则搜索，并可按文件名过滤", async () => {
  const { root, registry } = await fixture();
  await mkdir(join(root, "dmp-web"));
  await writeFile(join(root, "dmp-web", "DeviceServiceImpl.java"), "updateDevBot\nput mapping /device/dev-bot\n", "utf8");
  await writeFile(join(root, "readme.md"), "dev-bot is documented", "utf8");

  const found = await registry.execute("grep", {
    pattern: "dev-bot",
    include: "*.java",
  }, new AbortController().signal);
  expect(found).toEqual({
    output: "dmp-web/DeviceServiceImpl.java:2:put mapping /device/dev-bot",
    isError: false,
  });

  const missing = await registry.execute("grep", { pattern: "no-such-symbol" }, new AbortController().signal);
  expect(missing).toEqual({ output: "No matches found", isError: false });
});

test("list_files 拒绝非法查询参数", async () => {
  const { registry } = await fixture();
  for (const args of [
    { mode: "summary" },
    { maxResults: 0 },
    { extensions: "pdf" },
    { exclude: ["../outside"] },
  ]) {
    expect(await registry.execute("list_files", args, new AbortController().signal))
      .toMatchObject({ isError: true, error: { code: "INVALID_ARGUMENT" } });
  }
});

test("write_file 可在根目录内创建、覆盖，并创建缺失的父目录", async () => {
  const { root, registry } = await fixture();

  await expect(registry.execute(
    "write_file",
    { path: "nested/note.txt", content: "初稿" },
    new AbortController().signal,
  )).resolves.toEqual({ output: "wrote nested/note.txt (6 bytes)", isError: false });
  await expect(readFile(join(root, "nested", "note.txt"), "utf8")).resolves.toBe("初稿");

  await expect(registry.execute(
    "write_file",
    { path: "nested/note.txt", content: "" },
    new AbortController().signal,
  )).resolves.toEqual({ output: "wrote nested/note.txt (0 bytes)", isError: false });
  await expect(registry.execute(
    "read_file",
    { path: "nested/note.txt" },
    new AbortController().signal,
  )).resolves.toEqual({ output: expectedRead("nested/note.txt", ""), isError: false });
});

test("write_file 策略拒绝 ../、根外绝对路径和符号链接逃逸", async () => {
  const { root, outside, registry } = await fixture();
  await symlink(join(outside, "secret.txt"), join(root, "escape.txt"));
  await mkdir(join(outside, "elsewhere"));
  await symlink(join(outside, "elsewhere"), join(root, "escape-dir"));

  for (const path of ["../outside/secret.txt", join(outside, "secret.txt"), "escape.txt", "escape-dir/x.txt"]) {
    const result = await registry.execute(
      "write_file",
      { path, content: "leak" },
      new AbortController().signal,
    );
    expect(result).toMatchObject({ isError: true, error: { code: "DENIED" } });
    expect(result.output).toContain("outside the allowed root");
  }
  await expect(readFile(join(outside, "secret.txt"), "utf8")).resolves.toBe("不应读取");
});

test("write_file 将目录目标和超大内容规范化为独立错误码", async () => {
  const { root, registry } = await fixture();
  await mkdir(join(root, "folder"));
  const limited = new ToolRegistry();
  installReadFile(limited, { root, provider: new LocalFsProvider(), maxBytes: 4 });

  const directory = await registry.execute(
    "write_file",
    { path: "folder", content: "x" },
    new AbortController().signal,
  );
  expect(directory).toMatchObject({ isError: true, error: { code: "FS_NOT_FILE" } });

  const oversized = await limited.execute(
    "write_file",
    { path: "big.txt", content: "hello" },
    new AbortController().signal,
  );
  expect(oversized).toMatchObject({ isError: true, error: { code: "FS_TOO_LARGE" } });
});

test("文件工具可替换为非本地 Fs Provider", async () => {
  const files = new Map<string, string>([["/virtual/remote.txt", "virtual"]]);
  const provider: FsProvider = {
    async canonicalize(path) { return path; },
    async stat(path) {
      return files.has(path)
        ? { kind: "file", size: new TextEncoder().encode(files.get(path) ?? "").byteLength }
        : { kind: "directory", size: 0 };
    },
    async readText(path) { return files.get(path) ?? ""; },
    async readDirectory() {
      return [...files.keys()].map((path) => ({ name: path.slice(path.lastIndexOf("/") + 1), kind: "file" }));
    },
    async writeText(path, content) { files.set(path, content); },
  };
  const registry = new ToolRegistry();
  installReadFile(registry, { root: "/virtual", provider });

  await expect(registry.execute("read_file", { path: "remote.txt" }, new AbortController().signal))
    .resolves.toEqual({ output: expectedRead("remote.txt", "virtual"), isError: false });
  await expect(registry.execute("list_files", {}, new AbortController().signal))
    .resolves.toEqual({ output: "remote.txt", isError: false });
  await expect(registry.execute("write_file", { path: "saved.txt", content: "ok" }, new AbortController().signal))
    .resolves.toEqual({ output: "wrote saved.txt (2 bytes)", isError: false });
  expect(files.get("/virtual/saved.txt")).toBe("ok");
});

test("edit 对已有文件做唯一字面量替换，多处匹配需 replace_all", async () => {
  const { root, registry } = await fixture();
  await writeFile(join(root, "src.txt"), "foo bar foo", "utf8");

  const ambiguous = await registry.execute(
    "edit",
    { path: "src.txt", old_string: "foo", new_string: "baz" },
    new AbortController().signal,
  );
  expect(ambiguous).toMatchObject({ isError: true, error: { code: "FS_EDIT_AMBIGUOUS" } });
  await expect(readFile(join(root, "src.txt"), "utf8")).resolves.toBe("foo bar foo");

  await expect(registry.execute(
    "edit",
    { file_path: "src.txt", old_string: "foo", new_string: "baz", replace_all: true },
    new AbortController().signal,
  )).resolves.toEqual({
    output: "The file src.txt has been updated. All occurrences were successfully replaced.",
    isError: false,
  });
  await expect(readFile(join(root, "src.txt"), "utf8")).resolves.toBe("baz bar baz");

  await expect(registry.execute(
    "edit",
    { path: "src.txt", old_string: "bar", new_string: "qux" },
    new AbortController().signal,
  )).resolves.toEqual({
    output: "The file src.txt has been updated successfully.",
    isError: false,
  });
  await expect(readFile(join(root, "src.txt"), "utf8")).resolves.toBe("baz qux baz");

  const missing = await registry.execute(
    "edit",
    { path: "src.txt", old_string: "nope", new_string: "x" },
    new AbortController().signal,
  );
  expect(missing).toMatchObject({ isError: true, error: { code: "FS_EDIT_NOT_FOUND" } });
});

test("Loop 源码不出现 write_file 分支", () => {
  const source = readFileSync(new URL("../src/loop.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/write_file/u);
});
