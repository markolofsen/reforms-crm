# 24. The embedded terminal, the agent modes and Agent tools

A right-hand column in the admin where Claude Code, Codex or a plain shell run in the instance, beside the drafts they make (track P49, decision 0027). Off unless the instance says `terminal.enabled: true`. This page owns the contract, the guards, the presets, the two agent modes and the Agent tools rows.

## Switches (`config/config.json`, instance)

| Key | Default | What it does |
|---|---|---|
| `terminal.enabled` | `false` | The terminal routes and the socket exist. Off, every `/api/terminal/*` route but the state and the upgrade answer 404, and the admin draws no strip and no button. Only an exact `true` turns it on |
| `agent.default` | `claude` | The CLI `hub agent`, the `hub` menu and the terminal's `+` start first (`claude` or `codex`) |
| `agent.unattended` | `false` | No prompts, the OS sandbox on (the table below). Only an exact `true` |

A server restart (`./run.sh up`) applies a change; `hub doctor` row `agent.terminal` says when the config and the running server disagree.

## The two modes of a hub agent session

`hub agent <slug> [--cli claude|codex|shell] [--prepare]` starts the session in the instance root, bound to one project, with the server's Node first on `PATH`. The terminal's presets run exactly this command, so a session is the same from Terminal.app and from the admin.

| | Attended (default) | Unattended (`agent.unattended: true`) |
|---|---|---|
| Prompts | the CLI asks (Claude's default mode, Codex `-a on-request`) | none (Claude `--dangerously-skip-permissions`, Codex `-a never`) |
| OS sandbox | Codex: the `hub` profile; Claude: off | on: Claude's `sandbox` settings block (`enabled`, `failIfUnavailable`, `allowUnsandboxedCommands: false`, no allowed domain, no local binding, `denyWrite` on the protected paths); Codex: the `hub` permissions profile, `approval_policy = "never"` |
| Network from commands | Claude: yes; Codex: off | off (no loopback: the send route and the API are out of reach) |
| MCP servers (mail-mcp, Notion, knowledge-mcp) | work | work unchanged: the CLI calls them outside the sandbox |
| Send tools off, strict MCP, deny rules, guard hook (Claude) or forbidden rules (Codex) | yes | yes |
| Send policy server-owned (S11), manual send needs a ticket (S12) | yes | yes |

Never: Codex `--dangerously-bypass-approvals-and-sandbox` or `--yolo` (`codexArgs` throws, `hub doctor` fails on a config that sets it). In attended mode the person answering the prompts is the guard; in unattended mode the sandbox is.

**Protected paths** (read-only in the sandbox, Edit deny rules in every mode, because Claude's Edit and Write tools are not sandboxed): `state/projects/` (the send policies and session files), `state/secrets/` (unreadable), `state/codex/`, `config/`, the core, `run.sh`, `.claude/`, `.mcp.json`, `.git`, `CLAUDE.md`, `AGENTS.md`; other projects' folders are unreadable. The database folder stays writable so `hub record-draft` works inside the sandbox; `hub record-draft` loads only its own project's folder.

**Codex** has no strict-MCP flag, so each project gets its own `CODEX_HOME`: `state/codex/<slug>/` with `config.toml` (the hub's MCP servers only, `disabled_tools` per server, the `hub` profile: `":root" = "read"`, `":workspace_roots" = "write"`, the protected paths `"read"`, secrets and other projects `"none"`, network `enabled = false`; the project trusted; the owner's `model` and `model_reasoning_effort` carried), `rules/hub.rules` (`hub send`, the API and loopback as `forbidden` prefixes), `skills/` (links to the core skills) and `auth.json` (a link to the owner's, never a copy). A remote MCP server that needs OAuth (Notion) signs in once per `CODEX_HOME`.

Measured on Claude Code 2.1.220 and Codex 0.146.0 (2026-11-18), unattended, in a scratch instance: a decimal-IP `curl` to the send route exits 7 in both; `osascript` to Mail fails in both; `echo >>` the policy file is refused by the OS in both; Claude's Edit and Codex's `apply_patch` on it are refused; `hub record-draft` works. Another CLI version is a WARN in Agent tools: rerun those checks.

## Send policy and send ticket

`state/projects/<slug>/send-policy.json` replaces the `draft.recipients` and `send.*` rows of `project.md`; `hub send policy` is the one writer ([16-projects-and-knowledge.md](16-projects-and-knowledge.md) section 3B). `POST /api/sends/tickets {project, draftId}` mints a single-use ticket (60 s, bound to `send:<draftId>`) for the admin's exact origin with `Sec-Fetch-Site: same-origin`; the apply step of `POST /api/projects/:slug/drafts/:id/send` needs it, else 403.

## The terminal: contract

Wire shapes: `@hub/contract/terminal`. Server: `@hub/terminal` (sessions, PTY, presets, env, socket; imported by `apps/server` only) and `apps/server/src/terminal.ts`, `routes/terminal.ts`.

| Route | What it does |
|---|---|
| `GET /api/terminal` | `{enabled: false}` when off; on: `{enabled, unattended, presets, sessions}` |
| `POST /api/terminal/sessions` | `{preset: "claude" \| "codex" \| "shell", project?}` (strict: no command, no path). 201 with the session; 400 an unknown preset or a CLI without a project, 404 an unknown project, 409 at 8 live sessions |
| `DELETE /api/terminal/sessions/:id` | Closes the tab: SIGHUP to the process group, SIGKILL after 3 s |
| `POST /api/terminal/tickets` | `{session}`: a single-use ticket (30 s, bound to `term:<id>`) and the socket URL `ws://127.0.0.1:<api port>/terminal`; exact admin origin and `Sec-Fetch-Site: same-origin` |
| upgrade `/terminal` | straight to the API port (not through Next's rewrite). 404 when off or another path, 400 with a query string (a ticket in a URL is logged), 403 for a Host that is not loopback or an Origin that is not the admin's |

Socket: the first frame is `{op: "auth", ticket}` within 2 s, else close 4401 (4404 when the session is gone); then `ready`, a snapshot of the screen (`@xterm/headless` 5 000 lines, serialised), then the live stream. Bytes are binary frames both ways; control is JSON (`resize` clamped 2 to 500, `ping`/`pong`; `exit`, `taken`). One viewer per session: a second attach takes it and the first closes 4409. Output is batched at 16 ms; the PTY pauses above 1 MB queued in the socket and resumes under 256 KB.

Presets, a fixed server table: `claude` and `codex` spawn the argv `<server node> <hubBin> agent <slug> --cli <x>` through the owner's login shell for its environment (`$SHELL -l -i -c 'exec "$0" "$@"' <argv>`): nothing is typed into a prompt and no string is parsed, so a key pressed while the shell starts cannot corrupt the command (v0.9.1 typed it and a first key leaked in: `zsh: no such file or directory: д/Users/...`); the tab ends when the CLI exits. `shell` is the owner's own login shell (not sandboxed, as in Terminal.app). Without a project in the admin URL only Shell is offered. The shell is `$SHELL -l -i` in the instance root; env: the server's minus `HUB_MAILER`, `HUB_DB`, `HUB_PORT`, `HUB_CONNECTIONS_PROBE`, `HUB_TERMINAL_SHELL`, `HUB_AGENT_TOOLS`, `NODE_OPTIONS`, plus `HUB_HOME`, `HUB_PROJECT`, `TERM=xterm-256color`, `COLORTERM=truecolor`, UTF-8 `LANG`, `TERM_PROGRAM=hub`, and `COLORFGBG` for the admin's resolved theme when the tab starts (`0;15` light, `15;0` dark). The screen's colours are the `--terminal-*` tokens of the current theme, re-read live, and xterm answers a program's OSC 10/11 colour queries with them, so Claude Code and Codex can match their palette; the owner's own CLI settings (Claude's `/theme`) are never changed. Sessions end with the server; closing the column or the page only detaches.

`node-pty` 1.1.0 (the one native dependency) ships `prebuilds/darwin-*/spawn-helper` without the execute bit under pnpm; the server sets it before the first spawn (`ensureSpawnHelper`), and doctor row `agent.terminal` checks it. Tests: `HUB_TERMINAL_SHELL=fake` runs `app/test-support/fake-shell.mjs` and is refused without `HUB_DB`.

## Guards (threat: a web page in the owner's browser)

| # | Guard |
|---|---|
| S1 | Off by default; off = 404 |
| S2 | The listener binds 127.0.0.1 |
| S3 | Host must be a loopback name (DNS rebinding) |
| S4 | Exact admin Origin (`http://127.0.0.1:<admin port>` or `localhost`), a missing or `null` Origin refused, on the upgrade and the ticket routes |
| S5 | A ticket, not a cookie (cookies are not port-isolated); in memory, so a restart voids them |
| S6 | No CORS header anywhere; no state change on GET |
| S7 | Presets only: no route takes a command or a path; the slug is checked against the registry |
| S8 | XSS in the admin equals a shell: no `dangerouslySetInnerHTML` in `apps/admin` or `packages/ui` (rules test); terminal links open through `lib/external.ts` with `noopener` |
| S9 to S12 | The unattended sandbox, send tools off, the server-owned send policy, the send ticket (above) |

## Agent tools (Connections, second block)

`@hub/agent` `agentChecks({paths, slug, cli, unattended, probe})` returns rows `{id, cli, title, state: pass|warn|fail|skip, detail, fix}`; every row that is not a pass names one command line. The same rows serve `hub doctor` group `Agent` (one line per project and CLI, an audit row: `--fast` leaves it out) and `GET /api/projects/:slug/agent-tools` (the last result, computed on the first GET; `POST .../agent-tools/refresh` reruns it). `HUB_AGENT_TOOLS=fake` (e2e, refused without `HUB_DB`) returns fixed rows.

| Row | Pass when | Fix |
|---|---|---|
| `cli.version` | `--version` answers; another version than the measured one is a WARN | the install line |
| `cli.signed-in` | Codex: `codex login status` with the project's `CODEX_HOME`; Claude: skip (asks on first start) | `codex login && hub agent <slug> --cli codex --prepare` |
| `session.files` | the generated settings, MCP config (and Codex home) exist | `hub agent <slug> [--cli codex] --prepare` |
| `mcp.present.<server>`, `mcp.answers.<server>` | the server is in the session config and answers `initialize` + `tools/list`; Notion not signed in is a WARN | prepare; `hub doctor --only MCP`; `codex mcp login notion` |
| `send-tools.off` | every listed tool named like send, forward, reply, outgoing, delete, trash, move or cancel is denied (draft tools excepted); Codex disables them per server | `hub core update` (a new tool needs a core release) |
| `skills.linked` | links in `.claude/skills` (Claude) or the Codex home | prepare |
| `mode` | matches `agent.unattended`: Claude's sandbox block; Codex the `hub` profile, network off, the right approval policy, no bypass | prepare |
| `send.pipeline` | the policy file parses (none = drafts only, test recipients) | `hub send policy <slug>` |
| `guard.hook` | Claude's PreToolUse runs `hub guard`; Codex: skip | prepare |

`--prepare` writes the session files and starts nothing; it does not move the sticky project binding.

Update this page when the architecture changes.
