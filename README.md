# reforms-crm: an agent-first mail and CRM workflow

> This repository is the **core**: universal code, skills and docs, free of any owner's data. One owner's projects live in an
> **instance** outside it. Rule and steps: [`@docs/LAYERS.md`](@docs/LAYERS.md).

**The agent does the work, the admin shows it, the owner decides.** You start an agent session (Claude Code or Codex, `hub agent <project>`) and hand it one
instruction in your own words. The agent reads the project's mail in Apple Mail, updates the project's CRM in Notion through the session's own connector,
and leaves UNSENT reply drafts. The local admin (`hub up`) shows what it did, live: the drafts land in Drafts within a second, each with its reason and
checks, and Activity lists every client it handled. You read a draft and press Send, one at a time. The agent has no send tool; to whom a project's
drafts may go, and whether anything may go without a click, is that project's send policy, which only you set (`hub send policy`). Nothing is scheduled.

The admin carries the agent itself (always on, decision 0032): a terminal dock on the right edge (Ctrl+`) runs Claude Code, Codex or a shell beside
the drafts. The admin tells the agent what it shows (the shared focus), so "answer this client" means the draft on your screen.

## Quickstart
1. Node 22.20 or newer and pnpm (`./install.sh` in the core installs both and the dependencies). Make an instance (below). From it, `./run.sh setup` checks the folders, config, skills and project registry and ends with `ready: run hub agent`. It asks for no Claude or Notion token and writes nothing outside the instance. Which access goes to what: [`@docs/setup/access.md`](@docs/setup/access.md).
2. `./run.sh agent new`, then say `настрой проект <name>` (set up project): the `project-setup` skill interviews you and writes `projects/<slug>/project.md`. What to say for each skill: [`skills/README.md`](skills/README.md).
3. `./run.sh up` opens the admin. `./run.sh agent <slug>` (or the dock), then say `разбери почту проекта <name>` (triage the project's mail): the drafts appear in Drafts and wait unsent in Mail.

`./run.sh` alone opens a menu (agent session, admin, check, mail filters). The `hub` shortcut on PATH (`hub link`) is optional; `hub <command>` and `./run.sh <command>` are the same thing.
Needed once: Mail.app with the account, `mail-mcp` running, the Notion connector signed in (`/mcp` in Claude Code). `hub doctor` shows what is missing, each row with its fix; the full list is the generated [`@docs/setup/checklist.md`](@docs/setup/checklist.md).

## Creating an instance
Your data does not belong in this repository. Create an instance with one command: `./hub.sh init <folder>` (git, this repository as the `core/` submodule at the newest tag, the instance files, skill links, config defaults, `doctor`, one commit; `--pin main` follows the tip, `--dry-run` lists the files; it never pushes). Make the repository private before you push it.
The instance root is `HUB_HOME`: `projects/`, `data/`, `state/` and `config/` live there, and its `run.sh` sets `HUB_HOME` and runs the pinned core. Move to a newer core with `hub core update` (a test instance may follow `main` with `--branch`). Details:
[`@docs/LAYERS.md`](@docs/LAYERS.md) and [`@docs/core/08-local-app-stack.md`](@docs/core/08-local-app-stack.md).

## The commands
| Command | What it does |
|---|---|
| `hub agent [project] [--cli claude\|codex\|shell]` | The product: a Claude Code or Codex session in the instance (`agent.default`, default Claude). `<project>` binds a fresh session to one project; no argument continues the last one. `--prepare` writes the session files and starts nothing. The dock's tabs run exactly this command |
| `hub up [--demo]` | The local admin and its API on 127.0.0.1, opened in the browser: what the agent did, and your decisions. `--demo` uses invented data on a separate database |
| `hub doctor [project]` | Read-only health table, each row printed as its step ends, with its time; `--only <step or group>` runs just those, `--fast` leaves the audit (backup, Agent) checks out, `--canary` adds the lead-form canaries; never fails on optional things |
| `hub setup` | Idempotent install of folders, config, skills and the project registry (`./install.sh` runs it) |

`hub` alone opens a menu of the same things; `./hub.sh` does the same from a core checkout without an install. Other commands are hidden from `--help` and each has `hub <name> --help`: among them `hub send policy` (the send policy, the one writer), `hub sequences` (follow-ups), `hub connections`, `hub token`, `hub backup`, `hub core update`, and the ones a session calls (`hub record-draft`, `hub record-client`, `hub mcp`, `hub focus`).

## Where things are

The one index. Every page below owns its facts; others link to it.

| You want | Read |
|---|---|
| Which credential goes to what (Notion, mail, Telegram) | [`@docs/setup/access.md`](@docs/setup/access.md) |
| The working-order checklist of every node, backups included (generated from `hub doctor`) | [`@docs/setup/checklist.md`](@docs/setup/checklist.md) |
| The whole system in five minutes | [`@docs/00-README.md`](@docs/00-README.md) |
| Core versus instance | [`@docs/LAYERS.md`](@docs/LAYERS.md) |
| Skills and the phrase that starts each | [`skills/README.md`](skills/README.md) |
| The Notion CRM: databases, every field, setup | [`@docs/notion/README.md`](@docs/notion/README.md) |
| Connectors (mail-mcp, Notion MCP) | [`@docs/core/02-connectors.md`](@docs/core/02-connectors.md) |
| The local admin app: screens, API, where each fact lives | [`@docs/core/06-local-admin-app.md`](@docs/core/06-local-admin-app.md) |
| Live panels: how the admin updates by itself within a second while an agent writes (`GET /api/live`, the database triggers) | [`@docs/core/06-local-admin-app.md`, Live updates](@docs/core/06-local-admin-app.md#live-updates-p50-decision-0028-in-the-owners-plan-repo) |
| The stack and where files live (`HUB_HOME`) | [`@docs/core/08-local-app-stack.md`](@docs/core/08-local-app-stack.md) |
| Messengers (optional Telegram, receive only) | [`app/packages/messengers/README.md`](app/packages/messengers/README.md) |
| Bulk drafts, the review queue and Sent detection | [`@docs/core/14-bulk-send-interface.md`](@docs/core/14-bulk-send-interface.md) |
| The skill and pack that deploy a CRM into Notion | [`@docs/core/15-notion-project-deploy-skill.md`](@docs/core/15-notion-project-deploy-skill.md) |
| `project.md` schema v1, knowledge, routing, setup interview | [`@docs/core/16-projects-and-knowledge.md`](@docs/core/16-projects-and-knowledge.md) |
| Mail filters | [`@docs/core/17-mail-filters.md`](@docs/core/17-mail-filters.md) |
| The knowledge loop and `kb-review` | [`@docs/core/18-kb-loop.md`](@docs/core/18-kb-loop.md) |
| Calendar | [`@docs/core/19-calendar.md`](@docs/core/19-calendar.md) |
| Workflows | [`@docs/core/20-workflows.md`](@docs/core/20-workflows.md) |
| Leads: the writer contract and the read-only counts | [`@docs/core/21-leads.md`](@docs/core/21-leads.md) |
| Lead forms: the check that a lead still arrives (`hub doctor --only Leads`, the canary contract, `config/lead-forms.json`) | [`@docs/core/22-lead-forms.md`](@docs/core/22-lead-forms.md) |
| Follow-up sequences: the files, the enrollments, who may enrol, the Follow-ups view (`hub sequences`) | [`@docs/core/23-sequences.md`](@docs/core/23-sequences.md) |
| The terminal dock, the agent modes (attended, unattended with the OS sandbox), the send policy and send ticket, and Agent tools | [`@docs/core/24-terminal.md`](@docs/core/24-terminal.md) |
| Shared focus: what the agent knows of your screen (`hub mcp`, `hub focus`, the session rules, the prompt hook) | [`@docs/core/24-terminal.md`, Shared focus](@docs/core/24-terminal.md#shared-focus-the-agent-sees-what-the-owner-sees-p51-decision-0029) |
| The agent session log: every prompt, answer and tool call of a session, redacted, per project and day (`hub log`, `hub log summary`) | [`@docs/core/25-agent-log.md`](@docs/core/25-agent-log.md) |
| A package's own layout: `@hub/agent` (sessions, `hub mcp`, focus), `@hub/terminal`, `@hub/contract` (the API schemas), `@hub/sequences`, `@hub/ui`, `@hub/knowledge`, `@hub/notion` | `app/packages/<name>/README.md` |
| Rules for changing the admin app | [`app/@rules/README.md`](app/@rules/README.md) |

A new document takes the next free number in `@docs/core/` and a row here. Secrets live only in the git-ignored `state/secrets/`; local settings `config/config.json`, `.mcp.json` and `state/` are git-ignored too.

## Architecture

| Part | Where | Does |
|---|---|---|
| Skills | `skills/` (instructions, not code) | Tell an agent session what to do for what you ask; each instance links them into its own `.claude/skills/` (and the Codex home), generated and git-ignored |
| `hub` CLI | `app/apps/installer` | Starts the agent (`hub agent`) and the admin (`hub up`), checks health (`hub doctor`), records what a session did (`hub record-draft`, `hub record-client`), serves the read-only `hub` MCP server (`hub mcp`) |
| Server | `app/apps/server`, 127.0.0.1:4317 | Owns `data/app.db`, the live stream, the confirmed Send (send policy and single-use ticket), Sent detection, the terminal's sessions, the shared focus, the optional Telegram poller |
| Admin | `app/apps/admin`, 127.0.0.1:5173 | Drafts (the home), Activity, Project, Connections, Overview with two or more projects, and the terminal dock; talks only to the server |

Agent sessions: attended (the CLI asks) by default, or `agent.unattended: true` (no prompts, the OS sandbox on, never a sandbox bypass). In both, the send tools are denied, the session cannot write the send policy, and `hub audit-run <transcript.jsonl> --project <slug>` checks a session after the fact ([`24`](@docs/core/24-terminal.md)). Mail goes through Apple Mail only (`mail-mcp` on :8787 for the agent, no send tool; `osascript` for the hub's send and Sent detection); client records live in Notion; project facts, knowledge, follow-up sequences and development plans are files in `projects/<slug>/`. An instance owns its data, config, secrets, backups and skills; the user's home holds at most the optional `hub` shortcut ([`08`](@docs/core/08-local-app-stack.md)). Details: [`@docs/00-README.md`](@docs/00-README.md).

## License
Not chosen yet: see `LICENSE.todo`.

Update this page when the architecture changes.
