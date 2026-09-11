import { Context } from "@deepseek-ai/cordis";
import { expect, test } from "vitest";
import { MemorySessionPersistence } from "../src/session-persistence.ts";
import { SessionStoreService } from "../src/session-service.ts";

test("SessionStoreService 通过 ctx.sessions 提供可替换 Provider", async () => {
  const ctx = new Context();
  const memory = new MemorySessionPersistence();
  const fiber = ctx.plugin(SessionStoreService, { tmp: memory });
  await fiber.await();

  expect(ctx.sessions.sources()).toEqual(["tmp"]);
  await ctx.sessions.get("tmp").create("one.jsonl");
  await ctx.sessions.get("tmp").append("one.jsonl", { type: "user", text: "hello" });
  expect(await memory.load("one.jsonl")).toEqual([{ type: "user", text: "hello", seq: 1 }]);

  await fiber.dispose();
  expect(ctx.get("sessions")).toBeUndefined();
});

test("inject 消费者随 sessions Service 挂载和卸载", async () => {
  const ctx = new Context();
  const lifecycle: string[] = [];
  const consumer = Object.assign((child: Context) => {
    lifecycle.push(`mounted:${child.sessions.sources().join(",")}`);
    return () => { lifecycle.push("disposed"); };
  }, { inject: ["sessions"] });
  const consumerFiber = ctx.plugin(consumer);
  await consumerFiber.await();
  expect(lifecycle).toEqual([]);

  const serviceFiber = ctx.plugin(SessionStoreService, { tmp: new MemorySessionPersistence() });
  await serviceFiber.await();
  await consumerFiber.await();
  expect(lifecycle).toEqual(["mounted:tmp"]);

  await serviceFiber.dispose();
  expect(lifecycle).toEqual(["mounted:tmp", "disposed"]);
  await consumerFiber.dispose();
});
