import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  JsonlSessionPersistence,
  MemorySessionPersistence,
  type SessionPersistence,
} from "../src/session-persistence.ts";
import type { SessionEvent } from "../src/session.ts";
import { forkSession, SessionStore } from "../src/session-store.ts";

const factories: Array<[string, () => Promise<SessionPersistence>]> = [
  ["memory", async () => new MemorySessionPersistence()],
  ["jsonl", async () => new JsonlSessionPersistence(await mkdtemp(join(tmpdir(), "tiny-harness-persistence-")))],
];

for (const [name, createProvider] of factories) {
  describe(`SessionPersistence contract: ${name}`, () => {
    test("create、append、load、list、remove 与 clear 行为一致", async () => {
      const persistence = await createProvider();
      const first = "first.jsonl";
      const second = "second.jsonl";
      const event: SessionEvent = { type: "user", text: "hello" };

      await persistence.create(first);
      await persistence.append(first, event);
      expect(await persistence.load(first)).toEqual([event]);
      const listed = await persistence.list();
      expect(listed.map((item) => item.id)).toEqual([first]);
      expect(listed[0]?.updatedAt).toBeGreaterThan(0);

      await persistence.create(second);
      await persistence.remove(first);
      await expect(persistence.load(first)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await persistence.clear()).toBe(1);
      expect(await persistence.list()).toEqual([]);
    });

    test("重复创建和读取缺失会话明确失败", async () => {
      const persistence = await createProvider();
      await persistence.create("same.jsonl");
      await expect(persistence.create("same.jsonl")).rejects.toMatchObject({ code: "EEXIST" });
      await expect(persistence.load("missing.jsonl")).rejects.toMatchObject({ code: "ENOENT" });
    });
  });
}

for (const [name, createProvider] of factories) {
  describe(`SessionStore contract: ${name}`, () => {
    test("并发追加分配稳定序号并通知订阅者", async () => {
      const store = new SessionStore(await createProvider());
      const id = "sequenced.jsonl";
      const observed: number[] = [];
      await store.create(id);
      store.subscribe(id, (event) => { observed.push(event.seq); });
      store.subscribe(id, () => { throw new Error("observer failed"); });

      await Promise.all([
        store.append(id, { type: "user", text: "one" }),
        store.append(id, { type: "assistant", text: "two" }),
        store.append(id, { type: "end", reason: "done" }),
      ]);

      expect((await store.load(id)).map((event) => event.seq)).toEqual([1, 2, 3]);
      expect(observed).toEqual([1, 2, 3]);
    });

    test("append 后使缓存 projection 失效", async () => {
      const store = new SessionStore(await createProvider());
      const id = "projection.jsonl";
      let builds = 0;
      const key = Symbol("count");
      await store.create(id);
      const count = () => store.project(id, key, (events) => { builds += 1; return events.length; });

      expect(await count()).toBe(0);
      expect(await count()).toBe(0);
      await store.append(id, { type: "user", text: "new" });
      expect(await count()).toBe(1);
      expect(builds).toBe(2);
    });

    test("恢复时拒绝重复、缺口和序号缺失", async () => {
      const persistence = await createProvider();
      const id = "broken-sequence.jsonl";
      await persistence.create(id);
      await persistence.append(id, { type: "user", text: "one", seq: 1 } as SessionEvent);
      await persistence.append(id, { type: "assistant", text: "three", seq: 3 } as SessionEvent);

      await expect(new SessionStore(persistence).load(id)).rejects.toMatchObject({
        code: "INVALID_SESSION_SEQUENCE",
      });
    });

    test("按 seq fork 后边界前一致，边界后父子互不影响", async () => {
      const persistence = await createProvider();
      const store = new SessionStore(persistence);
      await store.create("parent.jsonl");
      await store.append("parent.jsonl", { type: "user", text: "one" });
      await store.append("parent.jsonl", { type: "assistant", text: "two" });
      await store.append("parent.jsonl", { type: "user", text: "three" });

      const child = await forkSession(store, "parent.jsonl", store, "child.jsonl", 2);
      expect(child).toEqual((await store.load("parent.jsonl")).slice(0, 2));
      await store.append("parent.jsonl", { type: "assistant", text: "parent-only" });
      await store.append("child.jsonl", { type: "assistant", text: "child-only" });
      expect((await store.load("parent.jsonl")).at(-1)).toMatchObject({ text: "parent-only", seq: 4 });
      expect((await store.load("child.jsonl")).at(-1)).toMatchObject({ text: "child-only", seq: 3 });
      await expect(forkSession(store, "parent.jsonl", store, "invalid.jsonl", 99))
        .rejects.toMatchObject({ code: "INVALID_SESSION_FORK" });
    });
  });
}

test("JSONL 忽略未完成尾行，但拒绝中间损坏", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tiny-harness-truncated-"));
  const persistence = new JsonlSessionPersistence(directory);
  const tail = "truncated.jsonl";
  await persistence.create(tail);
  await writeFile(join(directory, tail), '{"type":"user","text":"ok","seq":1}\n{"type":"assistant"', "utf8");
  expect(await persistence.load(tail, { repair: false })).toEqual([{ type: "user", text: "ok", seq: 1 }]);
  expect(await readFile(join(directory, tail), "utf8")).toBe('{"type":"user","text":"ok","seq":1}\n{"type":"assistant"');
  expect(await persistence.load(tail)).toEqual([{ type: "user", text: "ok", seq: 1 }]);
  expect(await readFile(join(directory, tail), "utf8")).toBe('{"type":"user","text":"ok","seq":1}\n');
  await persistence.append(tail, { type: "assistant", text: "continued", seq: 2 } as SessionEvent);
  expect(await persistence.load(tail)).toHaveLength(2);

  const middle = "invalid-middle.jsonl";
  await persistence.create(middle);
  await writeFile(join(directory, middle), '{"type":"user","text":"ok","seq":1}\nnope\n{"type":"end","reason":"done","seq":2}\n', "utf8");
  await expect(persistence.load(middle)).rejects.toMatchObject({ code: "INVALID_SESSION_JSONL" });
  expect(await readFile(join(directory, middle), "utf8")).toContain("nope");
});
