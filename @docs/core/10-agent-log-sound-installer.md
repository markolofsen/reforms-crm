# 10. Agent action log, sound notifications, installer

> **2026-11-14 update (decision a decision or plan record kept in the owner's instance): manual-first.** The owner starts a session (`hub agent` or Claude Desktop) and gives ONE instruction (`skills/README.md`). launchd, the gate, the Claude and Notion tokens, Full Disk Access and sounds are the OPTIONAL automation, OFF by default (`pnpm hub setup --automation`). Where this page says one of them is required, read it as the design of that optional automation.

Status: the gate, launchd jobs, notify and sounds were built as OPTIONAL automation and ARCHIVED on 2026-11-15 (P25: the archived agent-gate material (not part of this repo), the archived installer-automation material (not part of this repo); final delete 2026-12-15). This page is their design record; the installer today has none of them. Originally asked by the owner 2026-11-14.

## 1. Action log with reasoning (in the app)
- Table `agent_runs`: id, started_at, finished_at, trigger (schedule / owner / skill name), skill, model, status (ok / needs_human / failed), tokens_in, tokens_out, cost_usd.
- Table `agent_events`: run_id, seq, at, kind (`thought` | `tool_call` | `tool_result` | `decision` | `draft_created` | `notion_write` | `needs_human` | `error`), tool, summary (one line, shown), detail (JSON, collapsed), client_id.
- Source: the `claude -p --output-format stream-json` stream of each run is parsed by the gate script and written as events. Reasoning text is stored as `thought` events, so the owner reads "why" next to the draft it produced.
- UI: a Runs screen (list, status, cost) and per client a timeline. Detail is an inline disclosure, no dialogs. Retention: keep 90 days of `detail`, keep summaries forever.
- Never log mail bodies in `summary`; bodies stay in Mail, `detail` holds message ids.

## 2. Sound notifications
Principle: sound only for what needs a person; everything else is silent and visible in Reports.
| Event | Sound | Why |
|---|---|---|
| `needs_human` (agent is blocked or unsure) | two-note rise, repeats once after 10 min if unseen | the only interrupt |
| draft batch ready for review | one soft tone | action available, not urgent |
| run failed / auth expired | low double tone | the system is not working |
| message sent | none by default (the agent never sends; the owner does) | nothing to notice |
How: the app plays short files (Web Audio) while a tab is open; a `notify.sh` called by the gate uses `afplay` plus a macOS notification (`osascript`) when no tab is open. Settings are three switches in the app: sound on/off, quiet hours (reuse the gate's), volume. Per-event table above is the default config file `config/sounds.json`. Open question: any sound the owner already likes; we ship three free-licence samples.

## 3. Installer
(Default today: minimal and tokenless, `./install.sh` -> `ready: run hub agent`; installer step 5 (launchd jobs) and the sound parts run only with `--automation`.)
One command on a fresh Mac, idempotent, prints what it did and what is left:
1. Check Node, pnpm, Claude CLI, Mail accounts present.
2. Install dev-time skills (`coss`, `coss-particles`, via the `skills` CLI) and link run-time skills from `skills/` into `~/.claude/skills`.
3. Register MCP servers: `mail-mcp`, official Notion MCP, our local MCP (`05`).
4. Create `state/` and `app.db` (run migrations), write `config/*.example` if missing, never overwrite.
5. Install launchd jobs (gate every N min, daily Notion dump, app server) with the absolute paths.
6. Run `doctor`: reads one mail, one Notion page, writes one test draft in a scratch place, plays a sound; prints a pass/fail table.
Manual steps it cannot do (listed at the end): `claude setup-token`, Notion integration sharing, Full Disk Access for Mail.
Location: `reforms-crm/app/apps/installer/` (`@hub/installer`; run `hub install` (hidden command) and `hub doctor`).

## 4. Guided manual steps (added 2026-11-14, owner ask)
The installer must not hide the steps it cannot do. Each manual step is a numbered guide the installer prints and then verifies, so a client who deploys the system knows what happens and why:
1. `claude setup-token`: what it is (a long-lived token for unattended runs), where to store it (`state/secrets/`, git-ignored, mode 600), how the gate reads it (`CLAUDE_CODE_OAUTH_TOKEN`). Check: a `claude -p` ping run under launchd's environment returns, not "OAuth session expired".
2. Notion: create the integration, share the CRM teamspace with it, paste the token. Check: read one database.
3. Mail: add accounts in Apple Mail; grant Full Disk Access/Automation to the process that runs the jobs. Check: read one message.
4. Quiet hours and sound preferences.
The owner has already done step 1 on his Mac; the installer still carries it as a documented, verified step for other machines. A `docs/client-setup.md` is generated from the same step list, so the guide and the checks cannot drift.

Research results (decisions a decision or plan record kept in the owner's instance): sounds via `afplay` + osascript, repeat from a state file, 60-min watchdog; installer on commander + @clack/prompts + execa with `doctor` from the same checks.

## 5. One command (built 2026-11-14, made tokenless by decision 0006)
`./install.sh` at the repo root bootstraps Node/pnpm/dependencies and runs `pnpm hub setup`: minimal and tokenless, ending with `ready: run hub agent`. The guided wizard for section 4 (tokens validated before they are stored; resumable; `--non-interactive` for scripted installs) is `pnpm hub setup --automation`, OFF by default. See a decision or plan record kept in the owner's instance.
