import { Context } from "@deepseek-ai/cordis";
import { expect, test } from "vitest";
import { FakeLlm } from "../src/llm.ts";
import { LlmService, type LlmProviderService } from "../src/llm-service.ts";

function provider(): LlmProviderService {
  return {
    async create(prompt) { return new FakeLlm([{ kind: "text", text: `reply:${prompt}` }]); },
    async describe() {
      return { provider: "openai-compatible", baseURL: "https://example.test", model: "test", hasApiKey: true };
    },
    async update() { return this.describe(); },
  };
}

test("LlmService 通过 ctx.llm 隔离设置存储和具体适配器", async () => {
  const ctx = new Context();
  const fiber = ctx.plugin(LlmService, provider());
  await fiber.await();
  expect(await ctx.llm.describe()).toMatchObject({ model: "test" });
  const llm = await ctx.llm.create("hello");
  await expect(llm.complete([], [])).resolves.toEqual({ kind: "text", text: "reply:hello" });
  await fiber.dispose();
  expect(ctx.get("llm")).toBeUndefined();
});

test("inject 消费者只在 llm Service 可用期间挂载", async () => {
  const ctx = new Context();
  const lifecycle: string[] = [];
  const consumer = Object.assign((child: Context) => {
    lifecycle.push("mounted");
    void child.llm.describe();
    return () => { lifecycle.push("disposed"); };
  }, { inject: ["llm"] });
  const consumerFiber = ctx.plugin(consumer);
  await consumerFiber.await();
  expect(lifecycle).toEqual([]);
  const serviceFiber = ctx.plugin(LlmService, provider());
  await serviceFiber.await();
  await consumerFiber.await();
  expect(lifecycle).toEqual(["mounted"]);
  await serviceFiber.dispose();
  expect(lifecycle).toEqual(["mounted", "disposed"]);
  await consumerFiber.dispose();
});
