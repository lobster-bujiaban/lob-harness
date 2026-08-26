import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { LlmSettingsStore } from "../src/llm-settings.ts";
import { createWebServer, sessionFile } from "../src/web.ts";

test("sessionFile 拒绝路径穿越", () => {
  expect(() => sessionFile("tmp", "../package.json")).toThrow("invalid file");
  expect(() => sessionFile("tmp", "notes.txt")).toThrow("invalid file");
  expect(() => sessionFile("other", "replay.jsonl")).toThrow("unknown source");
  expect(sessionFile("fixtures", "replay.jsonl")).toMatch(/replay\.jsonl$/);
});

test("回放 API 能列出并读取 fixture", async () => {
  const root = await mkdtemp(join(tmpdir(), "tiny-harness-web-replay-"));
  const roots = { tmp: join(root, "tmp"), fixtures: join(root, "fixtures") };
  await mkdir(roots.fixtures, { recursive: true });
  await writeFile(join(roots.fixtures, "replay.jsonl"), [
    JSON.stringify({ type: "user", text: "hello" }),
    JSON.stringify({ type: "assistant", text: "world" }),
    "",
  ].join("\n"));
  const server = createWebServer({ roots });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  try {
    const promptRes = await fetch(`http://127.0.0.1:${port}/api/prompts/promo-video`);
    const prompt = (await promptRes.json()) as { text: string };
    expect(promptRes.ok).toBe(true);
    expect(prompt.text).toContain("video_analyze_source");
    expect(prompt.text).toContain("video_render_hyperframes");

    const versionRes = await fetch(`http://127.0.0.1:${port}/api/dev/version`);
    const version = (await versionRes.json()) as { version: string };
    expect(versionRes.ok).toBe(true);
    expect(version.version).toMatch(/^\d+:\d+(?:\.\d+)?$/u);

    const reloadRes = await fetch(`http://127.0.0.1:${port}/api/plugins/workspace-files/reload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { maxFileBytes: 2048 } }),
    });
    expect(reloadRes.status).toBe(200);
    await expect(reloadRes.json()).resolves.toMatchObject({
      id: "workspace-files",
      phase: "active",
      config: { maxFileBytes: 2048 },
    });

    const listRes = await fetch(`http://127.0.0.1:${port}/api/sessions`);
    const list = (await listRes.json()) as { source: string; file: string }[];
    expect(listRes.ok).toBe(true);
    expect(list.some((item) => item.source === "fixtures" && item.file === "replay.jsonl")).toBe(
      true,
    );

    const sessionRes = await fetch(
      `http://127.0.0.1:${port}/api/sessions/fixtures/replay.jsonl`,
    );
    const session = (await sessionRes.json()) as {
      events: { type: string }[];
      messages: { role: string }[];
    };
    expect(sessionRes.ok).toBe(true);
    expect(session.events.map((event) => event.type)).toEqual(["user", "assistant"]);
    expect(session.messages[0]?.role).toBe("user");
    expect(session.messages.at(-1)?.role).toBe("assistant");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("对话 API 可新建 tmp 会话并发送一轮", async () => {
  const root = await mkdtemp(join(tmpdir(), "tiny-harness-web-turn-"));
  const roots = { tmp: join(root, "tmp"), fixtures: join(root, "fixtures") };
  let requestCount = 0;
  const llmSettings = new LlmSettingsStore(join(roots.tmp, "config"), async () => {
    requestCount += 1;
    const chunk = requestCount === 1
      ? {
          choices: [{
            delta: {
            tool_calls: [{
              index: 0,
              id: "call-1",
              type: "function",
              function: { name: "echo", arguments: '{"text":"hello"}' },
            }],
            },
            finish_reason: "tool_calls",
          }],
        }
      : { choices: [{ delta: { content: "已完成" }, finish_reason: "stop" }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  });
  await llmSettings.update({
    provider: "openai-compatible",
    baseURL: "https://example.test/v1",
    model: "demo-model",
    apiKey: "test-key",
  });
  const server = createWebServer({ roots, llmSettings });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  try {
    const denied = await fetch(
      `http://127.0.0.1:${port}/api/sessions/fixtures/replay.jsonl/turn`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hi" }),
      },
    );
    expect(denied.status).toBe(403);

    const created = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
      method: "POST",
    });
    const session = (await created.json()) as { source: string; file: string };
    expect(created.status).toBe(201);
    expect(session.source).toBe("tmp");

    const turned = await fetch(
      `http://127.0.0.1:${port}/api/sessions/${session.source}/${session.file}/turn`,
      {
        method: "POST",
        headers: {
          accept: "text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({ text: "hello" }),
      },
    );
    const stream = await turned.text();
    const doneBlock = stream
      .split("\n\n")
      .find((block) => block.startsWith("event: done\n"));
    const doneData = doneBlock
      ?.split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice(6);
    const body = JSON.parse(doneData ?? "null") as { events: { type: string; seq: number }[] };
    expect(turned.ok).toBe(true);
    expect(turned.headers.get("content-type")).toContain("text/event-stream");
    expect(stream).toContain("event: session_event");
    expect(body.events.map((event) => event.type)).toEqual([
      "workspace_root",
      "inbox_inserted",
      "turn_start",
      "inbox_claimed",
      "step_start",
      "user",
      "request_start",
      "assistant_chunk",
      "request_end",
      "tool_call",
      "tool_result",
      "step_end",
      "step_start",
      "request_start",
      "assistant_chunk",
      "request_end",
      "assistant",
      "step_end",
      "turn_end",
    ]);
    const boundary = body.events.find((event) => event.type === "tool_result")?.seq;
    expect(boundary).toBeTypeOf("number");
    const forked = await fetch(
      `http://127.0.0.1:${port}/api/sessions/${session.source}/${session.file}/fork`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seq: boundary }),
      },
    );
    const child = (await forked.json()) as { source: string; file: string };
    expect(forked.status).toBe(201);
    expect(child.source).toBe("tmp");
    const childResponse = await fetch(`http://127.0.0.1:${port}/api/sessions/tmp/${child.file}`);
    const childSession = (await childResponse.json()) as { events: { seq: number }[] };
    expect(childSession.events).toHaveLength(boundary ?? 0);
    expect(childSession.events.at(-1)?.seq).toBe(boundary);
    expect(requestCount).toBe(2);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("停止 API 取消活动 turn，并等待 Agent 回到 idle", async () => {
  const root = await mkdtemp(join(tmpdir(), "tiny-harness-web-stop-"));
  const roots = { tmp: join(root, "tmp"), fixtures: join(root, "fixtures") };
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  const llmSettings = new LlmSettingsStore(join(roots.tmp, "config"), async (_input, init) => {
    requestStarted();
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  await llmSettings.update({
    provider: "openai-compatible",
    baseURL: "https://example.test/v1",
    model: "demo-model",
    apiKey: "test-key",
  });
  const server = createWebServer({ roots, llmSettings });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  try {
    const created = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
      method: "POST",
    });
    const session = (await created.json()) as { source: string; file: string };
    const base = `http://127.0.0.1:${port}/api/sessions/${session.source}/${session.file}`;
    const turn = await fetch(`${base}/turn`, {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "一直等待" }),
    });
    const turnBody = turn.text();
    await started;

    const stopped = await fetch(`${base}/stop`, { method: "POST" });
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toEqual({ cancelled: true });
    expect(await turnBody).toContain("event: done");

    const replay = await fetch(base);
    const body = (await replay.json()) as {
      events: Array<{ type: string; reason?: { kind: string } }>;
    };
    expect(body.events.filter((event) => event.type === "request_start")).toHaveLength(1);
    expect(body.events.at(-1)).toMatchObject({
      type: "turn_end",
      reason: { kind: "aborted" },
    });

    const alreadyIdle = await fetch(`${base}/stop`, { method: "POST" });
    expect(await alreadyIdle.json()).toEqual({ cancelled: false });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("两个会话可以同时跑 turn，同一会话重复发送仍 409", async () => {
  const root = await mkdtemp(join(tmpdir(), "tiny-harness-web-parallel-"));
  const roots = { tmp: join(root, "tmp"), fixtures: join(root, "fixtures") };
  const started: Array<() => void> = [];
  const llmSettings = new LlmSettingsStore(join(roots.tmp, "config"), async () => {
    await new Promise<void>((resolve) => { started.push(resolve); });
    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  });
  await llmSettings.update({
    provider: "openai-compatible",
    baseURL: "https://example.test/v1",
    model: "demo-model",
    apiKey: "test-key",
  });
  const server = createWebServer({ roots, llmSettings });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  try {
    const first = await (await fetch(`${origin}/api/sessions`, { method: "POST" })).json() as { source: string; file: string };
    const second = await (await fetch(`${origin}/api/sessions`, { method: "POST" })).json() as { source: string; file: string };
    const turn = (file: string, text: string) => fetch(
      `${origin}/api/sessions/tmp/${file}/turn`,
      {
        method: "POST",
        headers: {
          accept: "text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({ text }),
      },
    );

    const firstTurn = turn(first.file, "会话一");
    await expect.poll(() => started.length).toBe(1);
    const duplicate = await turn(first.file, "同一会话");
    expect(duplicate.status).toBe(409);

    const secondTurn = turn(second.file, "会话二");
    await expect.poll(() => started.length).toBe(2);
    for (const release of started) release();

    expect((await firstTurn).ok).toBe(true);
    expect((await secondTurn).ok).toBe(true);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("删除 API 只删除指定 tmp 会话，清空 API 保留 fixtures", async () => {
  const root = await mkdtemp(join(tmpdir(), "tiny-harness-web-"));
  const roots = {
    tmp: join(root, "tmp"),
    fixtures: join(root, "fixtures"),
  };
  await mkdir(roots.tmp, { recursive: true });
  await mkdir(roots.fixtures, { recursive: true });
  await writeFile(join(roots.tmp, "one.jsonl"), `${JSON.stringify({ type: "workspace_root", path: "/workspace-a" })}\n`);
  await writeFile(join(roots.tmp, "two.jsonl"), `${JSON.stringify({ type: "workspace_root", path: "/workspace-a" })}\n`);
  await writeFile(join(roots.tmp, "three.jsonl"), `${JSON.stringify({ type: "workspace_root", path: "/workspace-b" })}\n`);
  await writeFile(join(roots.tmp, "keep.txt"), "not a session");
  await writeFile(join(roots.fixtures, "replay.jsonl"), "");

  const server = createWebServer({ roots });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    const fixtureDenied = await fetch(
      `${base}/api/sessions/fixtures/replay.jsonl`,
      { method: "DELETE" },
    );
    expect(fixtureDenied.status).toBe(403);
    await expect(readFile(join(roots.fixtures, "replay.jsonl"), "utf8")).resolves.toBe("");

    const deleted = await fetch(`${base}/api/sessions/tmp/one.jsonl`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ deleted: 1 });
    expect(await readdir(roots.tmp)).not.toContain("one.jsonl");

    const missing = await fetch(`${base}/api/sessions/tmp/one.jsonl`, {
      method: "DELETE",
    });
    expect(missing.status).toBe(404);

    const workspaceDeleted = await fetch(`${base}/api/sessions/tmp?workspaceRoot=${encodeURIComponent("/workspace-a")}`, {
      method: "DELETE",
    });
    expect(workspaceDeleted.status).toBe(200);
    await expect(workspaceDeleted.json()).resolves.toEqual({ deleted: 1 });
    expect(await readdir(roots.tmp)).not.toContain("two.jsonl");

    const cleared = await fetch(`${base}/api/sessions/tmp`, {
      method: "DELETE",
    });
    expect(cleared.status).toBe(200);
    await expect(cleared.json()).resolves.toEqual({ deleted: 1 });
    expect(await readdir(roots.tmp)).toEqual(["keep.txt"]);
    await expect(readFile(join(roots.fixtures, "replay.jsonl"), "utf8")).resolves.toBe("");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("模型设置 API 保存配置但绝不返回明文 Key", async () => {
  const root = await mkdtemp(join(tmpdir(), "tiny-harness-web-settings-"));
  const roots = { tmp: join(root, "tmp"), fixtures: join(root, "fixtures") };
  const server = createWebServer({ roots });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  try {
    const saved = await fetch(`${base}/api/settings/llm`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "openai-compatible",
        baseURL: "https://example.test/v1",
        model: "demo-model",
        apiKey: "web-test-secret-value",
        dashscopeApiKey: "web-dashscope-secret-value",
      }),
    });
    const raw = await saved.text();
    expect(saved.ok).toBe(true);
    expect(raw).not.toContain("web-test-secret-value");
    expect(raw).not.toContain("web-dashscope-secret-value");
    expect(JSON.parse(raw)).toMatchObject({
      provider: "openai-compatible",
      baseURL: "https://example.test/v1",
      model: "demo-model",
      hasApiKey: true,
      hasDashscopeApiKey: true,
      activeProfileId: "default",
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("临时会话可持久选择 workspace，fixture 和非目录被拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "tiny-harness-web-workspace-"));
  const roots = { tmp: join(root, "tmp"), fixtures: join(root, "fixtures") };
  const workspace = join(root, "selected-workspace");
  await mkdir(roots.tmp, { recursive: true });
  await mkdir(roots.fixtures, { recursive: true });
  await mkdir(workspace);
  await writeFile(join(roots.tmp, "session.jsonl"), "");
  await writeFile(join(roots.fixtures, "replay.jsonl"), "");
  await writeFile(join(root, "not-directory.txt"), "file");
  const server = createWebServer({ roots });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api/sessions`;

  try {
    const updated = await fetch(`${base}/tmp/session.jsonl/workspace`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: workspace }),
    });
    expect(await updated.json()).toEqual({ workspaceRoot: await realpath(workspace) });

    const loaded = await fetch(`${base}/tmp/session.jsonl`);
    const session = await loaded.json() as {
      workspaceRoot: string;
      events: Array<{ type: string; path?: string }>;
    };
    expect(session.workspaceRoot).toBe(await realpath(workspace));
    expect(session.events.at(-1)).toEqual({
      type: "workspace_root",
      path: await realpath(workspace),
      seq: 1,
    });

    const fixture = await fetch(`${base}/fixtures/replay.jsonl/workspace`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: workspace }),
    });
    expect(fixture.status).toBe(403);

    const invalid = await fetch(`${base}/tmp/session.jsonl/workspace`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: join(root, "not-directory.txt") }),
    });
    expect(invalid.status).toBe(400);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
