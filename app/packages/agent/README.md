# @hub/agent

What an agent session of the hub is, for both CLIs (Claude Code and Codex), and what it may read of the admin. The design, the
two modes, the guards and the Agent tools rows are owned by `@docs/core/24-terminal.md`; this page is the package's layout.

| Export | What |
|---|---|
| `./session` | The two modes (`agent.unattended` false: the CLI asks; true: no prompts, the OS sandbox on), the protected paths, the CLI versions the guards were measured on, `CLI_LABELS` |
| `./claude`, `./codex` | One session of each CLI, built without writing: Claude's settings (P55: `model`, and `advisorModel` or the advisor's off switch, from the project's agent settings; `ADVISOR_RULE`, the advisor's rule line), strict MCP file and deny rules; Codex's own home `state/codex/<slug>/` (`config.toml`, `rules/hub.rules`, `skills/` links, `auth.json` link). `hub agent` (`apps/installer/src/agent.ts`) writes them |
| `./deny` | What no session may use in any mode: send-like tools (`SEND_LIKE_TOOL`, draft tools excepted), `hub send`, the owner-only sequence commands, the local API by address, other projects' folders; the hub's MCP servers (`HUB_MCP_SERVERS`). A belt beside the sandbox, not the boundary |
| `./checks` | `agentChecks(...)`: the Agent tools rows per project and CLI, each red row with one fix line; rows 1 and 2 come from `./detect`. One source for `hub doctor --only Agent` and Settings ▸ Agent (P70) |
| `./detect` | `detectClis()`: path, version and sign-in of Claude Code and Codex in ONE login-shell spawn; `pickPreset()` (what the terminal starts by itself, P57), `cliDetector()` (the server's cache), `INSTALL_LINE` and `LOGIN_LINE` |
| `./focus` | `readFocus`, the one reader of the shared focus (`state/focus.json`, ids only), resolved in the database opened read-only and scoped to the bound project: `fresh`, `stale`, `elsewhere`, `none`. `hub focus --hook` and the `focus` tool both use it |
| `./mcp`, `./mcp-stdio` | `hub mcp`: the hub's stdio MCP server for `HUB_PROJECT`: read-only `focus`, `draft_show`, `client_show`, `drafts_list` (database opened read-only, never a draft body) and `draft_write`, the one Mail write (P52; a revision names only the hub draft and bumps the live topic `mail`, P53; every version it saves is recorded in `mail_versions` on a short write connection, a new reply to a message the project already answers is refused `already_drafted`, and a text ending with the agent's own closing is refused `own_signoff`, P65) |
| `./mail-drafts` | The draft writer behind `draft_write` (P52, decision 0030): an unsent reply saved in Mail's Drafts through Mail's scripting, no window, no focus, no paste; it writes the reply text only (no hub line, decision 0031), finds its draft as a new draft of the thread in any of the project's accounts (Mail saves it in its From's account) whose text starts with the written text, and returns its Message-ID, its account and the text read back (`versionHash`); a revision moves to Trash only the older versions the caller names from `mail_versions`, each in its own account, re-checked by account and Message-ID just before the delete, and this run's own extras (a second save, Mail's reply shell); a draft not seen within 45 s is `mail_slow` (P65 S5); `writeRecorded` records each write first (`mail_writes`) and `lateSaves` finds the Hub's late saves by hash; `findInbound` finds the answered message by Message-ID (read-only). No send |
| `./write-record` | P65 S5: the write record (`writeLogOf`) and the adoption of late saves (`recordAdoptions`) over any write handle: `hub mcp`'s short connections, the server's and `hub drafts unmark`'s repositories |
| `./session-rules` | `sessionRules(slug)`: the text appended to every session's system prompt; the core `AGENTS.md` section of the same heading must equal it (`apps/installer/test/docs.test.ts`) |

Imported by `apps/installer` and `apps/server`, never by the admin. Depends on `@hub/config`, `@hub/contract`, `@hub/db` and `@hub/projects` (a project's Mail accounts for `draft_write`).
Tests: `pnpm --filter @hub/agent test` (`test/checks.test.ts`, `test/claude-model.test.ts`, `test/detect.test.ts`, `test/focus.test.ts`, `test/mail-drafts.test.ts`).

Update this page when the architecture changes.
