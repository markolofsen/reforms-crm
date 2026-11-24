# 25. The agent session log

Every question the owner asks a hub agent session (Claude Code or Codex), every answer, every tool call and every wait on the owner, kept per project so the sessions can be analysed later (track P54). It records; it never decides, blocks or sends. Read it with `hub log`. Not the ops log: what failed in the server and the packages (a disconnect, a Mail or Notion error, a refused send) is `hub logs`, `state/log/ops-<day>.jsonl` ([28-ops-log.md](28-ops-log.md)).

## What is recorded, and from where

The sources are the CLIs' own hooks, never the terminal's byte stream: a session from Terminal.app and one in the admin's dock are logged the same way. Hooks that already ran before P54 carry most of it, so the log adds almost no work to a session.

| Kind | What | Claude Code | Codex |
|---|---|---|---|
| `prompt` | what the owner typed | the prompt hook `hub focus --hook` (already ran for the shared focus); a message typed while a turn runs is queued and runs no prompt hook, so the `Stop` hook imports it from the transcript (`queued_command`) with `queued: true` (P59) | the same hook |
| `focus` | the `[Hub focus, data]` line that hook added to the prompt | the same hook, same turn | the same |
| `answer` | the agent's final message of a turn (`last_assistant_message`) | `hub log --hook` on `Stop`, in line (after the answer is shown) | `hub log --hook` on `Stop` |
| `tool_call` | the tool and its input | `hub guard` (`PreToolUse`, already ran) | imported at `Stop` from the Codex rollout |
| `tool_result` | the result (an excerpt, or a hash for mail), with its duration | `hub guard --post` (`PostToolUse`, already ran) | imported at `Stop` from the rollout |
| `tool_error` | a call that failed or was refused | `PostToolUseFailure`, `PermissionDenied` | (in the rollout output) |
| `asked` | the CLI waited on the owner: a permission prompt, an idle wait, a permission request | `Notification` (`permission_prompt`, `idle_prompt`, `elicitation_dialog`, `agent_needs_input`) | `PermissionRequest` |
| `guard` | a violation `hub guard` saw, warn or block (this replaced `state/guard.log`) | `hub guard` | (Codex has no guard hook) |
| `session` | start and end, with the path of the native transcript | `SessionStart`, `SessionEnd` | `SessionStart` |
| `error` | the turn ended on an API failure | `StopFailure` | none |

Claude's `hub log --hook` entries are `async: true` (in the background, never delaying a prompt) except `Stop` and `StopFailure`: measured in print mode on 2.1.220, an async `Stop` hook wrote nothing, so the answer's hook runs in line, about 0.5 s after the answer is already on screen. Codex 0.146 skips async hooks, so its log hooks block; that is why Codex has no hook per tool call: the `Stop` hook (once per turn) reads the new part of the session's rollout (`transcript_path`) from a byte cursor (`state/log/<slug>/.cursor/<session>`) and writes that turn's calls and results. Codex's `SessionEnd` is not hooked: its budget (1 s) is below a Node start. Codex's code mode calls MCP tools from inside an `exec` script (`tools.mcp__hub__focus({})`), so such a call is logged as `exec` with the tools its script names in `via`; a script that names a mail-body tool or `draft_write` keeps its code and its output as hashes only. Measured on Claude Code 2.1.220 and Codex 0.146.0 (2026-11-19), a real `exec` turn of each in saas.

The hub's own MCP server (`hub mcp`: `focus`, `draft_show`, `draft_write`, ...) is not logged separately: its calls are tool calls like any other and reach the same hooks. The admin's actions are not logged here: sends, marks and draft events are already rows of the database (Activity's timeline, its Sends view).

## The event

One JSON line per event in `state/log/<slug>/<YYYY-MM-DD>.jsonl` (UTC day; `_unbound` for a session bound to no project). Folder 700, file 600, append only. The folder is `hubPaths().log`.

| Field | |
|---|---|
| `v` | 1 |
| `ts` | ISO time (a rollout line keeps its own time) |
| `project` | `HUB_PROJECT`, or null |
| `session` | the CLI's session id |
| `cli` | `claude` or `codex` |
| `kind` | the table above |
| `turn` | Claude `prompt_id`, Codex `turn_id`: a prompt, its tools and its answer share it |
| `corr` | the tool call id: pairs a call with its result or error |
| `agent` | a subagent's id |
| `data` | per kind: `text`, `line`, `tool`, `input`, `output`, `ms`, `error`, `why`, `mode`, `violations`, `phase`, `transcript` ... |

Schema and writer: `@hub/log` (`app/packages/log`: `event.ts`, `store.ts`, `privacy.ts`, `hooks.ts`, `codex-rollout.ts`, `claude-transcript.ts`, `summary.ts`; the feed's reading: `feed.ts`, `feed-labels.ts`).

A session keeps the hooks it started with: a session opened before a core update that added hooks (a dock tab left open, a Terminal.app session) writes only what its old hooks write. Measured 2026-11-19 (P57 R0): a saas session started before v0.12.6 logged its prompt (the old prompt hook runs the new code) and its tool calls (`hub guard`), but no session start, no tool error and no answer (its `stop_hook_summary` lists two hooks, neither the hub's), so `hub log summary` said "no answer". Start a new session after a core update; `hub agent` writes the session files at every start.

## Privacy

- **Secrets.** Every event's data passes once through `redact` of `@hub/connections`: every value stored under `state/secrets/`, and anything shaped like a key (`sk-`, `ntn_`, `secret_`, GitHub, Slack, AWS, JWT, a Telegram bot token, a `Bearer` value).
- **Mail bodies are never kept** (decision 0013: the body lives in Mail). The result of a mail-mcp tool other than the header-only `list_accounts`, `list_mailboxes`, `find_messages`, and the `content`/`body` input of `draft_write` and the mail compose tools, are stored as `{sha256, chars}`: the same text gives the same hash, so a repeated reply is still visible.
- **Sizes.** Prompts and answers up to 8 000 characters, any other string up to 2 000; a line over 16 KB keeps its envelope and says how big it was.
- **Local only.** `state/` is git-ignored and never leaves the machine; backups do not copy it.
- **The agent cannot edit its log** in Claude Code: `state/log` has an Edit deny rule in every mode and is `denyWrite` in the unattended sandbox (hooks run outside the sandbox, so they still write). In Codex it is not protected yet: whether Codex runs hooks under its `hub` profile is unmeasured, and a read-only folder there would be a silent log.

## Retention

Rotation is by day. The first write of a day deletes that project's day files older than `log.retention_days` in `config/config.json` (a whole number from 1 to 3650; default 90). Nothing is scheduled. To keep a session longer, copy its day files.

## Reading it: `hub log`

| Command | What |
|---|---|
| `hub log` | the last 200 events (default: `HUB_PROJECT`, else every project; the last 7 days) |
| `hub log tail` | the last 20, then follows (once a second) |
| `hub log sessions` | one line per session: CLI, project, start, prompts, tool calls, errors, flagged turns |
| `hub log summary [--session <id>]` | per session: counts, the top tools, the transcript path, the friction counters, and every flagged turn with its question and answer; last, the friction counters over the sessions shown (P133, P129 section 6: shell calls of a deleted hub writer, guard evidence warnings in turns that carried the owner's words, turns with ToolSearch, turns with AskUserQuestion, turns that asked instead of acting, the median turn time) |

Filters on every view: `--project`, `--session` (a prefix), `--kind prompt,answer`, `--cli`, `--since 6h|7d|<date>`, `--until`, `--limit`, `--json`. The kinds are listed in `hub log --help`.

A queued message (above) joins the turn it was typed into: `summary` shows it as `Q (queued)` under that turn's question, and it does not count as a prompt of its own.

Flags of `summary` (the "where did the agent ask instead of acting" question):

| Flag | When |
|---|---|
| asked instead of acting | the answer ends in a question and no tool ran in the turn |
| asked after acting | the answer ends in a question after tool calls |
| waited on the owner | a permission prompt, an idle wait or a permission request in the turn |
| no answer | a prompt with no answer (the turn stalled, or the session was closed) |
| errors | a tool error, a refusal or an API failure |

`HUB_GUARD=block` is decided from `hub log --kind guard` (a week of warn-mode violations), which replaced `state/guard.log`. Old `state/guard.log` files are left where they are and nothing reads them.

## The activity feed (P59)

The terminal strip's dot turns to the attention colour while the agent waits on the owner, and a turn that ended plays one tone. It is a read of this log's tail, not a second writer and not a log view. Until P73 the sidebar also showed the last five labelled steps; they went (decision 0037): the draft writes among them are Activity's rows, the wait is the dot, and the rest (answered, reads a message) are steps the terminal shows live and `hub log` keeps.

- **Route.** `GET /api/projects/:slug/agent-feed` (`apps/server/src/agent/feed-routes.ts`, read only, the general loopback guard; shape `@hub/contract/agent-feed`, strict): `turns` (the last 10 that ended, each with one `tone`) and `waiting`. No row, label or cursor since P73. `tailEvents` (`@hub/log/feed`) reads the last 64 KB of today's day file (UTC), and of yesterday's when today's is short; a turn ends at a position `<day>:<byte offset>`, because time order is not append order.
- **Labels, on the server only.** One table (`feed-labels.ts`; P59's table 4c) names a tool call ("records draft 1", "writes a new draft") and says whether it earns the ready tone; since P73 no label leaves the server. The reply carries no prompt, answer, command, query, address, subject, path or any input or output (a test serialises a reply built from the saas shapes and looks for the address and the mailRef).
- **Tones, one per turn.** Problem (a guard violation or an API error in the turn), then attention (the answer ends in a question; a permission prompt or request, an elicitation, `agent_needs_input`), then ready (a draft written by `draft_write`, or `draft_write`'s record that said `ok`; once, even when both happened). Silent: routine calls, `idle_prompt`, a failed tool the agent recovered from, a turn that just answered. A turn's id is stable, so it sounds once; events from before the page loaded never sound. `waiting`: some session's latest event (an idle reminder or a start aside) asks for the owner, under an hour ago.
- **Live.** The server watches `state/log` per project (each project folder's two newest `*.jsonl`: names, sizes, times; every 500 ms; `.cursor/` and `_unbound` are not compared) and bumps the topic `agent-log` for each project that moved; the admin refetches the feed. No hook changed and no hook writes SQLite.
- **Latency, two different promises.** The transport: a line appended to the day file shows within about 0.3 to 0.9 s (watch 500 ms, tail 200 ms, coalesce 100 ms, the stream, one GET). Before that, the line has to exist. Claude Code writes each tool call and result as it happens, after the hook's own Node start (1 to 5 s per call pair measured 2026-11-19); the answer about 0.5 s after it is on screen. Codex writes the prompt and a permission request at once, but every tool call only at the turn's end (`Stop`), back-dated to the rollout's time: the feed never shows Codex mid-turn.

## Health

Agent tools row `log.hooks` (Agents and `hub doctor --only Agent`): the session files carry the prompt hook with `--cli` and `hub log --hook`; a fail is fixed by `hub agent <slug> --prepare` (or the next `hub agent <slug>`). No admin screen shows the log itself (admin-principles rule 2: the question is the owner's analysis after the fact, not a decision); Activity shows what the agent decided per client (the `agent_events` rows, decision 0037), and the dot and the tones above say when it waits or finished.

Update this page when the architecture changes.
