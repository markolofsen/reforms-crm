# {{NAME}}

An **instance** of the reforms-crm core: the data of one business owner's projects, with no code. The core is the `core/` submodule, pinned in `core.version`.
Keep this repository private: it holds client facts. Secrets live only in `state/secrets/` (git-ignored). The instance owns its data, config, secrets, backups and skills (linked into its own `.claude/skills/`); nothing lives in your home folder except the optional `hub` shortcut (`hub link`).

## What is here

| Path | What |
|---|---|
| `projects/<slug>/` | one folder per project: `project.md`, `knowledge/` |
| `@dev/` | this owner's kanban (`active/`, `blocked/`, `planned/`, `completed/`, `decisions/`, `_archive/`) |
| `@docs/custom/` | this owner's own notes and live facts |
| `@refs/` | reference material of this owner |
| `core.version` | the core version this instance runs on (the only place it is stated) |
| `state/`, `data/`, `config/config.json`, `.mcp.json`, `.claude/skills/` | working state and generated files; git-ignored |

## Daily use

Run everything from this folder (the command finds the instance, and runs the pinned `core/`):

```sh
./run.sh doctor                    # setup checks, instance-vs-core check, project table
./run.sh agent <project>           # a Claude Code session bound to one project; then say «настрой проект <project>» the first time
./run.sh up                        # the admin: review the drafts (ports: admin_port / api_port in config/config.json)
./run.sh core update               # list core versions; --apply <tag> moves the pin, --branch main follows main
```

After a fresh clone: `git clone --recurse-submodules <this repo>`, then `(cd core/app && pnpm install --frozen-lockfile)`.
