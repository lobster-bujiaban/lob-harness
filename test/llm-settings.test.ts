import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { LlmSettingsStore } from "../src/llm-settings.ts";
import { OpenAiCompatLlm } from "../src/llm.ts";

test("模型设置默认使用真实 OpenAI 兼容配置", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tiny-harness-settings-"));
  const store = new LlmSettingsStore(directory);

  await expect(store.describe()).resolves.toMatchObject({
    provider: "openai-compatible",
    baseURL: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    hasApiKey: false,
    hasDashscopeApiKey: false,
    activeProfileId: "default",
  });

  const saved = await store.update({
    provider: "openai-compatible",
    baseURL: "https://example.test/v1/",
    model: "demo-model",
    apiKey: "test-secret-value",
  });
  expect(saved).toMatchObject({
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

test("更新和清除模型 Key 时保留 DashScope 凭据", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tiny-harness-settings-"));
  await writeFile(join(directory, "credentials.json"), JSON.stringify({
    version: 1,
    apiKey: "old-model-key",
    dashscopeApiKey: "dashscope-secret",
  }));
  const store = new LlmSettingsStore(directory);
  await store.update({ apiKey: "new-model-key" });
  expect(JSON.parse(await readFile(join(directory, "credentials.json"), "utf8"))).toEqual({
    version: 1,
    modelApiKeys: { default: "new-model-key" },
    dashscopeApiKey: "dashscope-secret",
  });
  await store.update({ clearApiKey: true });
  expect(await store.describe()).toMatchObject({ hasApiKey: false });
  expect(JSON.parse(await readFile(join(directory, "credentials.json"), "utf8"))).toEqual({
    version: 1,
    dashscopeApiKey: "dashscope-secret",
  });
});

test("多个模型配置独立保存密钥并切换当前模型", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tiny-harness-settings-"));
  const store = new LlmSettingsStore(directory);
  await store.update({ apiKey: "deepseek-key" });
  const created = await store.update({
    createProfile: true,
    profileId: "company-gateway",
    profileName: "公司网关",
    provider: "openai-compatible",
    baseURL: "https://gateway.example/v1",
    model: "company-model",
    apiKey: "gateway-key",
  });
  expect(created).toMatchObject({ activeProfileId: "company-gateway", model: "company-model", hasApiKey: true });
  expect(created.profiles).toEqual([
    expect.objectContaining({ id: "default", hasApiKey: true }),
    expect.objectContaining({ id: "company-gateway", hasApiKey: true }),
  ]);
  const switched = await store.update({ activeProfileId: "default" });
  expect(switched).toMatchObject({ activeProfileId: "default", model: "deepseek-v4-flash", hasApiKey: true });
  let credentials = JSON.parse(await readFile(join(directory, "credentials.json"), "utf8"));
  expect(credentials.modelApiKeys).toEqual({ default: "deepseek-key", "company-gateway": "gateway-key" });
  const deleted = await store.update({ deleteProfileId: "company-gateway" });
  expect(deleted.profiles?.map((profile) => profile.id)).toEqual(["default"]);
  credentials = JSON.parse(await readFile(join(directory, "credentials.json"), "utf8"));
  expect(credentials.modelApiKeys).toEqual({ default: "deepseek-key" });
});

test("模型设置拒绝无效地址和换行 Key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tiny-harness-settings-"));
  const store = new LlmSettingsStore(directory);
  await expect(store.update({ baseURL: "file:///tmp/model" })).rejects.toThrow("HTTP(S)");
  await expect(store.update({ apiKey: "bad\nkey" })).rejects.toThrow("API Key 格式无效");
});

test("使用对应提供方凭据获取 OpenAI 兼容模型目录", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tiny-harness-settings-"));
  const requests: { url: string; authorization: string | null }[] = [];
  const store = new LlmSettingsStore(directory, async (input, init) => {
    requests.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify({ data: [{ id: "model-b" }, { id: "model-a" }] }), { status: 200 });
  });
  await store.update({ apiKey: "catalog-key" });
  await expect(store.discoverModels({ profileId: "default" })).resolves.toEqual(["model-a", "model-b"]);
  expect(requests).toEqual([{ url: "https://api.deepseek.com/models", authorization: "Bearer catalog-key" }]);
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
