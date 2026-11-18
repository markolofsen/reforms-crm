# @hub/agent

What an agent session of the hub is, for both CLIs (Claude Code and Codex), and what it may read of the admin. The design, the
two modes, the guards and the Agent tools rows are owned by `@docs/core/24-terminal.md`; this page is the package's layout.

| Export | What |
|---|---|
| `./session` | The two modes (`agent.unattended` false: the CLI asks; true: no prompts, the OS sandbox on), the protected paths, the CLI versions the guards were measured on, `CLI_LABELS` |
| `./claude`, `./codex` | One session of each CLI, built without writing: Claude's settings, strict MCP file and deny rules; Codex's own home `state/codex/<slug>/` (`config.toml`, `rules/hub.rules`, `skills/` links, `auth.json` link). `hub agent` (`apps/installer/src/agent.ts`) writes them |
| `./deny` | What no session may use in any mode: send-like tools (`SEND_LIKE_TOOL`, draft tools excepted), `hub send`, the owner-only sequence commands, the local API by address, other projects' folders; the hub's MCP servers (`HUB_MCP_SERVERS`). A belt beside the sandbox, not the boundary |
| `./checks` | `agentChecks(...)`: the Agent tools rows per project and CLI, each red row with one fix line. One source for `hub doctor --only Agent` and the Connections page |
| `./focus` | `readFocus`, the one reader of the shared focus (`state/focus.json`, ids only), resolved in the database opened read-only and scoped to the bound project: `fresh`, `stale`, `elsewhere`, `none`. `hub focus --hook` and the `focus` tool both use it |
| `./mcp`, `./mcp-stdio` | `hub mcp`: the hub's stdio MCP server for `HUB_PROJECT`: read-only `focus`, `draft_show`, `client_show`, `drafts_list` (database opened read-only, never a draft body) and `draft_write`, the one Mail write (P52) |
| `./mail-drafts` | The draft writer behind `draft_write` (P52, decision 0030): an unsent reply saved in Mail's Drafts through Mail's scripting, no window, no focus, no paste; a revision removes only the older draft of the same account, subject and `[hub-draft thread=...]` marker, after the new one is found. No send |
| `./session-rules` | `sessionRules(slug)`: the text appended to every session's system prompt; the core `AGENTS.md` section of the same heading must equal it (`apps/installer/test/docs.test.ts`) |

Imported by `apps/installer` and `apps/server`, never by the admin. Depends on `@hub/config`, `@hub/contract`, `@hub/db` and `@hub/projects` (a project's Mail accounts for `draft_write`).
Tests: `pnpm --filter @hub/agent test` (`test/checks.test.ts`, `test/focus.test.ts`, `test/mail-drafts.test.ts`).

Update this page when the architecture changes.
