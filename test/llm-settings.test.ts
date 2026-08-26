import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { LlmSettingsStore } from "../src/llm-settings.ts";
import { OpenAiCompatLlm } from "../src/llm.ts";

test("模型设置默认使用真实 OpenAI 兼容配置", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tiny-harness-settings-"));
  const store = new LlmSettingsStore(directory);

  await expect(store.describe()).resolves.toEqual({
    provider: "openai-compatible",
    baseURL: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    hasApiKey: false,
  });

  const saved = await store.update({
    provider: "openai-compatible",
    baseURL: "https://example.test/v1/",
    model: "demo-model",
    apiKey: "test-secret-value",
  });
  expect(saved).toEqual({
    provider: "openai-compatible",
    baseURL: "https://example.test/v1",
    model: "demo-model",
    hasApiKey: true,
  });
  expect(saved).not.toHaveProperty("apiKey");
  await expect(new LlmSettingsStore(directory).createLlm("hello")).resolves.toBeInstanceOf(
    OpenAiCompatLlm,
  );
  expect(await readFile(join(directory, "llm-settings.json"), "utf8")).not.toContain(
    "test-secret-value",
  );

  if (process.platform !== "win32") {
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory, "llm-settings.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(directory, "credentials.json"))).mode & 0o777).toBe(0o600);
  }
});

test("空 Key 保留旧值，显式清除后真实模型不可用", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tiny-harness-settings-"));
  const store = new LlmSettingsStore(directory);
  await store.update({
    provider: "openai-compatible",
    baseURL: "https://example.test",
    model: "demo-model",
    apiKey: "existing-secret",
  });
  await expect(store.update({ apiKey: "" })).resolves.toMatchObject({ hasApiKey: true });
  await expect(store.update({ clearApiKey: true })).resolves.toMatchObject({
    hasApiKey: false,
  });
  await expect(store.createLlm("hello")).rejects.toThrow("请先在模型设置中配置 API Key");
});

test("模型设置拒绝无效地址和换行 Key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tiny-harness-settings-"));
  const store = new LlmSettingsStore(directory);
  await expect(store.update({ baseURL: "file:///tmp/model" })).rejects.toThrow("HTTP(S)");
  await expect(store.update({ apiKey: "bad\nkey" })).rejects.toThrow("API Key 格式无效");
});

test("旧模型名称读取时迁移为完整 V4 ID", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tiny-harness-settings-"));
  await writeFile(join(directory, "llm-settings.json"), JSON.stringify({
    version: 1,
    provider: "openai-compatible",
    baseURL: "https://api.deepseek.com",
    model: "v4-falsh",
  }));
  await expect(new LlmSettingsStore(directory).describe()).resolves.toMatchObject({
    model: "deepseek-v4-flash",
  });
});
