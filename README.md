# reforms-crm: a local, manual-first mail and CRM workflow

> This repository is the **core**: universal code, skills and docs, free of any owner's data. One owner's projects live in an
> **instance** outside it. Rule and steps: [`@docs/LAYERS.md`](@docs/LAYERS.md).

You start a Claude Code session (or Claude Desktop) and hand it ONE instruction. The agent reads a project's mail, updates the
project's CRM in Notion through the session's own connector, and leaves UNSENT reply drafts. Nothing runs in the background and
the agent never sends. A local admin app lets a person review each draft and send it one at a time.

## Quickstart
1. Make an instance (below). From it, `./run.sh setup` checks the folders, config, skills and project registry, and ends with `ready: run hub agent`. (`./install.sh` in the core installs Node, pnpm and the dependencies once; it runs `hub setup` only when `HUB_HOME` is set.) It asks for nothing: no Claude token, no Notion token. Which access goes to what: [`@docs/setup/access.md`](@docs/setup/access.md).
2. `./run.sh agent new`, then say `настрой проект <name>` (set up project): the `project-setup` skill interviews you and writes `projects/<slug>/project.md`. The trigger phrases of every skill are in [`skills/README.md`](skills/README.md).
3. `./run.sh agent <slug>`, then say `разбери почту проекта <name>` (triage the project's mail). Drafts land unsent in Mail.

Needed once: Mail.app with the account, `mail-mcp` running, the Notion connector signed in (`/mcp` in Claude Code). `hub doctor` shows what is missing, each row with its fix; the full list is the generated [`@docs/setup/checklist.md`](@docs/setup/checklist.md).

## Creating an instance
Your data does not belong in this repository. Create an instance with one command: `./hub.sh init ~/crm/my-instance` (git, this repository as the `core/` submodule at the newest tag, the instance files, skill links, config defaults, `doctor`, one commit; `--pin main` follows the tip, `--dry-run` lists the files; it never pushes). Make the repository private before you push it.
The instance root is `HUB_HOME`: `projects/`, `data/`, `state/` and `config/` live there, and its `run.sh` sets `HUB_HOME` and runs the pinned core. Move to a newer core with `hub core update` (a test instance may follow `main` with `--branch`). Details:
[`@docs/LAYERS.md`](@docs/LAYERS.md) and [`@docs/core/08-local-app-stack.md`](@docs/core/08-local-app-stack.md).

## The commands
| Command | What it does |
|---|---|
| `hub agent [project]` | The product: a Claude Code session. `<project>` binds a fresh session to one project; no argument continues the last one |
| `hub up [--demo]` | The local admin: review the drafts the agent made. `--demo` uses invented data on a separate database |
| `hub doctor [project]` | Read-only health table; never fails on optional things |
| `hub setup` | Idempotent install of folders, config, skills and the project registry (`./install.sh` runs it) |

`hub` alone opens a menu of the same four things; `./hub.sh` does the same without an install. Other commands (`hub projects`, `hub filters`, `hub test`, ...) are hidden from `--help`; each has `hub <name> --help`.

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
| The stack and where files live (`HUB_HOME`) | [`@docs/core/08-local-app-stack.md`](@docs/core/08-local-app-stack.md) |
| Messengers (optional Telegram, receive only) | [`app/packages/messengers/README.md`](app/packages/messengers/README.md) |
| Bulk send and the `bulk-drafts` skill | [`@docs/core/14-bulk-send-interface.md`](@docs/core/14-bulk-send-interface.md) |
| The skill and pack that deploy a CRM into Notion | [`@docs/core/15-notion-project-deploy-skill.md`](@docs/core/15-notion-project-deploy-skill.md) |
| `project.md` schema v1, knowledge, routing, setup interview | [`@docs/core/16-projects-and-knowledge.md`](@docs/core/16-projects-and-knowledge.md) |
| Mail filters | [`@docs/core/17-mail-filters.md`](@docs/core/17-mail-filters.md) |
| The knowledge loop and `kb-review` | [`@docs/core/18-kb-loop.md`](@docs/core/18-kb-loop.md) |
| Calendar | [`@docs/core/19-calendar.md`](@docs/core/19-calendar.md) |
| Workflows | [`@docs/core/20-workflows.md`](@docs/core/20-workflows.md) |
| Leads: the writer contract and the read-only counts | [`@docs/core/21-leads.md`](@docs/core/21-leads.md) |
| Rules for changing the admin app | [`app/@rules/README.md`](app/@rules/README.md) |

A new document takes the next free number in `@docs/core/` and a row here. Secrets live only in the git-ignored `state/secrets/`; local settings `config/config.json`, `.mcp.json` and `state/` are git-ignored too. `hub agent` runs Claude with `--dangerously-skip-permissions --chrome`; isolation rests on the skill rules plus `hub audit-run <transcript.jsonl> --project <slug>` after the fact. Extra readable folders: `HUB_EXTRA_DIRS`.

## Architecture

Skills (`skills/`, instructions) tell a Claude session what to do. The `hub` CLI (`app/apps/installer`) starts the agent, the admin and the doctor. The server (`app/apps/server`, 127.0.0.1:4317) owns `data/app.db`, the confirmed Send and the optional Telegram poller. The admin (`app/apps/admin`, 127.0.0.1:5173) only talks to the server. Mail goes through `mail-mcp` (:8787, no send tool); client records live in Notion; project facts and knowledge are files in `projects/<slug>/`. Details: [`@docs/00-README.md`](@docs/00-README.md).

## License
Not chosen yet: see `LICENSE.todo`.

Update this page when the architecture changes.
