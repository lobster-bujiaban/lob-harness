import { Context } from "@deepseek-ai/cordis";
import { expect, test } from "vitest";
import { SystemPromptService } from "../src/system-prompt.ts";

test("Prompt section 随贡献 Fiber 挂载和卸载", async () => {
  const ctx = new Context();
  const serviceFiber = ctx.plugin(SystemPromptService);
  await serviceFiber.await();
  const contribution = Object.assign((child: Context) =>
    child.systemPrompt.register({ id: "identity", text: "You are concise.", order: 10 }),
  { inject: ["systemPrompt"] });
  const contributionFiber = ctx.plugin(contribution);
  await contributionFiber.await();
  expect(ctx.systemPrompt.messages()).toEqual([{ role: "system", content: "You are concise." }]);

  await contributionFiber.dispose();
  expect(ctx.systemPrompt.messages()).toEqual([]);
  await serviceFiber.dispose();
  expect(ctx.get("systemPrompt")).toBeUndefined();
});

test("systemPrompt inject 消费者只在 Service 可用期间挂载", async () => {
  const ctx = new Context();
  const lifecycle: string[] = [];
  const consumer = Object.assign(() => {
    lifecycle.push("mounted");
    return () => { lifecycle.push("disposed"); };
  }, { inject: ["systemPrompt"] });
  const consumerFiber = ctx.plugin(consumer);
  await consumerFiber.await();
  expect(lifecycle).toEqual([]);
  const serviceFiber = ctx.plugin(SystemPromptService);
  await serviceFiber.await();
  await consumerFiber.await();
  expect(lifecycle).toEqual(["mounted"]);
  await serviceFiber.dispose();
  expect(lifecycle).toEqual(["mounted", "disposed"]);
  await consumerFiber.dispose();
});
