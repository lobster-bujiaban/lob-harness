import { Context } from "@deepseek-ai/cordis";
import { expect, test } from "vitest";
import { ToolsService } from "../src/tools-service.ts";

test("工具贡献随 Fiber 挂载和卸载，schema 与 executor 同时消失", async () => {
  const ctx = new Context();
  const serviceFiber = ctx.plugin(ToolsService);
  await serviceFiber.await();
  const contribution = Object.assign((child: Context) => child.tools.register("upper", (registry) => {
    registry.register({
      name: "upper",
      description: "uppercase",
      parameters: { type: "object" },
      executionMode: { kind: "parallel" },
      execute: () => "UPPER",
    });
  }), { inject: ["tools"] });
  const contributionFiber = ctx.plugin(contribution);
  await contributionFiber.await();

  const active = ctx.tools.createRegistry("/workspace");
  expect(active.schemas().map((schema) => schema.name)).toEqual(["upper"]);
  await expect(active.execute("upper", {}, new AbortController().signal))
    .resolves.toMatchObject({ output: "UPPER", isError: false });

  await contributionFiber.dispose();
  const unloaded = ctx.tools.createRegistry("/workspace");
  expect(unloaded.schemas()).toEqual([]);
  await expect(unloaded.execute("upper", {}, new AbortController().signal))
    .resolves.toMatchObject({ isError: true, error: { code: "UNKNOWN_TOOL" } });
  await serviceFiber.dispose();
  expect(ctx.get("tools")).toBeUndefined();
});
