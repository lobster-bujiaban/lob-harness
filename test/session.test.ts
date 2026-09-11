import { expect, test } from "vitest";
import * as session from "../src/session.ts";
import type { SessionEvent } from "../src/session.ts";

test("API 没有 edit / delete，改不了历史", () => {
  expect("edit" in session).toBe(false);
  expect("delete" in session).toBe(false);
});

test("workspace_root 使用最后一次持久选择，并且不进入模型投影", () => {
  const events: SessionEvent[] = [
    { type: "workspace_root", path: "/workspace/old" },
    { type: "user", text: "hello" },
    { type: "workspace_root", path: "/workspace/new" },
  ];

  expect(session.deriveWorkspaceRoot(events, "/fallback")).toBe("/workspace/new");
  expect(session.projectMessages(events)).toEqual([{ role: "user", content: "hello" }]);
});
