# reforms-crm: a local, manual-first mail and CRM workflow

> This repository is the **core**: universal code, skills and docs, free of any owner's data. One owner's projects live in an
> **instance** outside it. Rule and steps: [`@docs/LAYERS.md`](@docs/LAYERS.md).

You start a Claude Code session (or Claude Desktop) and hand it ONE instruction. The agent reads a project's mail, updates the
project's CRM in Notion through the session's own connector, and leaves UNSENT reply drafts. Nothing runs in the background and
the agent never sends. A local admin app lets a person review each draft and send it one at a time.

## Quickstart
1. Clone, then `./install.sh`. It checks Node and pnpm, installs dependencies (`pnpm install --frozen-lockfile` in `app/`), runs the minimal `hub setup`, puts `hub` on your PATH and ends with `ready: run hub agent`. It asks for nothing: no Claude token, no Notion token.
2. `hub agent new`, then say `настрой проект <name>` (set up project): the `project-setup` skill interviews you and writes `app/projects/<slug>/project.md`. The trigger phrases of every skill are in [`skills/README.md`](skills/README.md).
3. `hub agent <slug>`, then say `разбери почту проекта <name>` (triage the project's mail). Drafts land unsent in Mail.

Needed once: Mail.app with the account, `mail-mcp` running, the Notion connector signed in (`/mcp` in Claude Code). `hub doctor` shows what is missing, each row with its fix.

## Creating an instance
Your data does not belong in this repository. Make a private repository, add this one as a submodule `core/`, pin a commit,
and point `HUB_HOME` at the instance root; `projects/`, `data/`, `state/` and `config/` then live there. Details:
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
- Skills and the phrases that start them: [`skills/README.md`](skills/README.md). Design and install: [`@docs/00-README.md`](@docs/00-README.md); generated install guide: [`@docs/core/client-setup.md`](@docs/core/client-setup.md).
- Secrets (mail logins, optional tokens) live only in the git-ignored `state/secrets/` (override: `HUB_CONFIG_DIR`). Local settings `config/config.json`, `.mcp.json` and `state/` are git-ignored too.
- `hub agent` runs Claude with `--dangerously-skip-permissions --chrome`; isolation rests on the skill rules plus `hub audit-run <transcript.jsonl> --project <slug>` after the fact. Extra readable folders: `HUB_EXTRA_DIRS`.
- Rules for changing the code: [`app/@rules/README.md`](app/@rules/README.md).

## License
Not chosen yet: see `LICENSE.todo`.
