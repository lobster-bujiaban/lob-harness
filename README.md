English | [中文](README.cn.md)

# LOB Harness

**Status: research** — a runnable agent loop, not a production coding agent.

TypeScript port of the DeepSeek Harness shape: Cordis composition, JSONL sessions, a tool registry, and a Web UI. Assembly lives in `src/composition.ts`; the HTTP/SSE app is `src/web.ts`.

## What

Turn / step agent loop with JSONL replay, OpenAI-compatible streaming, workspace tools, macOS Seatbelt, in-process MCP demo, sub-agents, jobs, and goals.

## Run in 3 commands

Requires Node.js `^22.19.0` or `>=24.0.0` (`package.json` `engines`).

```bash
npm install
npm run web
open http://127.0.0.1:8787
```

`npm run web` is `tsx watch src/web.ts`. Bind is `process.env.PORT ?? 8787`. Create a session in the UI and set an OpenAI-compatible key under model settings (`src/llm-settings.ts`). Keys stay in gitignored `tmp/config/`.

```bash
npm test
npm run typecheck
```

## Architecture

Wired by `assembleWebContext` in `src/composition.ts`:

```text
web.ts (HTTP / SSE)
  → AgentService / AgentLoopService
  → runTurn (src/loop.ts): turn → step → LLM stream → tools
  → SessionStore + JsonlSessionPersistence
  → ToolsService / ToolRegistry (preExecute → execute → postExecute)
  → fs / shell+sandbox / MCP / subagent / jobs / goals
  → append SessionEvent
```

Default max steps: `100`. Default parallel tool concurrency: `4` (`src/loop.ts`).

Context fit uses a ~4 chars/token meter and tool-result prune / summary (`src/context.ts`).

## Tools (from plugins, not a hard-coded loop)

`src/plugins.ts` registers Cordis builtins. Enabled by default unless noted:

| Plugin id | Source | Tools |
|---|---|---|
| `core-tools` | `src/tools.ts` | `echo` |
| `workspace-files` | `src/files.ts` | `read_file`, `list_files`, `write_file`, `edit`, `grep` |
| `workspace-shell` | `src/bash.ts` | `bash` (or `pwsh` on win32) |
| `mcp-client` | `src/mcp.ts` | `mcp__demo__ping` — **off by default** |
| `subagent` | `src/subagent.ts` | `subagent` |
| `tool-jobs` | `src/jobs.ts` | `job`, `job_output`, `job_kill` |
| `tool-goal` | `src/goal.ts` | `get_goal`, `create_goal`, `complete_goal` |
| `hyperframes-video` | `src/hyperframes-video.ts` | `video_analyze_source`, `video_create_hyperframes`, `video_generate_voice`, `video_render_hyperframes` |
| `wechat-article` | `src/wechat-article.ts` | `wechat_create_article` |

MCP is `MemoryMcpSession`: in-process handlers, **no JSON-RPC / stdio / HTTP**. Public names are `mcp__{server}__{raw}` (`src/mcp.ts`).

## Sandbox

`LocalSandboxProvider` (`src/sandbox-service.ts`) wraps argv with macOS `sandbox-exec`. Modes: `read-only`, `workspace-write`, `danger-full-access`. If Seatbelt is missing, confined runs throw `SANDBOX_UNAVAILABLE` instead of running open. There is no Linux bwrap / Win32 ACL backend in this repo.

## Sessions and config

- Live sessions: JSONL under `tmp/` (`src/session-persistence.ts`).
- Read-only fixtures: `test/fixtures/`.
- Fork at an event boundary: `forkSession` in `src/session-store.ts`.
- Dump the Cordis tree: `node --import tsx src/web.ts --dump-config`
- Replace an entry by id (not deep merge): `--profile ./web.profile.json`

## Boundaries that match the code

- Sub-agents are in-process with their own JSONL; they cannot nest `subagent`, file writes, jobs, or goals (`src/subagent.ts`).
- `write_file` overwrites; `edit` is literal string replace (`src/files.ts`).
- Approval is a single-use provider on the registry (`src/tools.ts`, `src/approval.ts`).

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Contact

[chishishuan@gmail.com](mailto:chishishuan@gmail.com) · [GitHub Issues](https://github.com/lobster-bujiaban/lob-harness/issues)
