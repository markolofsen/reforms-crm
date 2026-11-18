# Two layers: core and instance

This repository is the **core** of a local, manual-first mail and CRM workflow. It is built to be handed to any owner,
who sets up his own projects with it. Everything in a working setup belongs to exactly one of two layers. If you are
unsure where a file goes, this page decides.

## The rule

- **Core** (this repository) is universal logic: it works for any owner and any project. It never names a specific client,
  project, mailbox, person, domain or Notion id. Examples use `<slug>`, `example.com`, `client@example.com`, and the
  invented projects `acme` and `nordhaus`.
- **Instance** is one owner's data: his projects, mailboxes, rules, decisions, history, secrets and working plans. It lives
  outside this repository (a separate repository per business owner is recommended) and is selected with `HUB_HOME`.
- Core may **read** an instance (it must, to run a project) but only through a lookup: a slug, a path under
  `<home>/projects/<slug>/`, a field of `project.md`. Core never copies an instance's facts into itself.
- Per-project behaviour differences are expressed as **data in the project folder** (`project.md` fields, `mail-filters.md`,
  `knowledge/`), never as `if slug == ...` in code or skills. A project that needs something the schema cannot say gets a new
  schema field (a core change), not a private branch.
- An instance never edits core to suit itself. A need that two owners would share becomes a core change; otherwise it stays in the instance.
- Core runs the same in every instance: agents reach Mail and Notion through their own connectors (`mail-mcp`, the session's Notion connector), the core's local tools (`hub record-draft`, `hub record-client`, `hub sequences`, the knowledge MCP, the guard) write the instance's database, and the admin shows that state. An instance differs only by data: its projects, and its brand (`name` and `logo` in `config/config.json`, which the admin's brand header reads), never by UI code.

## Where everything lives

| Path | Layer | Notes |
|---|---|---|
| `skills/` | core | The instructions agents follow. Examples use placeholders |
| `app/packages/`, `app/apps/` | core | The TypeScript monorepo and the `hub` CLI |
| `app/projects/_template/` | core | Template of a project folder: starter workflows, starter follow-up sequences ([core/23-sequences.md](core/23-sequences.md)), the `@dev/` kanban skeleton and the Notion CRM pack |
| `@docs/core/` | core | Design and how each subsystem works, one document each |
| `@docs/setup/` | core | `access.md` (which credential goes to what) and the generated `checklist.md` |
| `@docs/notion/` | core | The Notion CRM: setup and the generated `fields.md` |
| `@docs/00-README.md`, `@docs/LAYERS.md` | core | The overview and this rule; the one index is `README.md` |
| `app/@rules/` | core | Rules for changing the local apps |
| `config/mcp.json`, `install.sh`, `hub.sh` | core | Shared defaults and the bootstrap. `config/mcp.json` is a byte copy of `app/apps/installer/templates/mcp.json` (the installer's source); edit both together. The repo-root `.mcp.json` is a third, git-ignored copy written by setup |
| `projects/<slug>/` under `HUB_HOME` | **instance** | `project.md`, `mail-filters.md`, `knowledge/`, `reports/`, generated XML |
| `projects/<slug>/@dev/` under `HUB_HOME` | **instance** | The project's own development plans, a kanban (`hub dev init <slug> --apply` copies the skeleton from `app/projects/_template/@dev/`; `hub dev index` generates its table; doctor step `dev.kanban`). Tracked in the instance repository |
| `@docs/custom/`, `@dev/`, `@refs/` of an instance | **instance** | The owner's history, decisions, plans and reference material; the instance-wide kanban. Work on one project goes in that project's `@dev/` |
| `config/config.json`, `state/` (secrets in `state/secrets/`), `.mcp.json`, `.claude/` | **instance**, git-ignored | Local settings, runtime state and every secret (the Connections page and `hub token` write only here). `state/projects/<slug>/send-policy.json` is each project's send policy, written only by `hub send policy` ([core/24-terminal.md](core/24-terminal.md)); `state/codex/<slug>/` the generated Codex homes |

## Create an instance

1. Make a private repository for the owner (one per business owner, not per project: one client's mail must not share a repo with another party's).
2. Add this repository as a submodule named `core/` and pin it to a release commit. That commit is the only statement of the core version.
3. In the instance root run with `HUB_HOME` set to it (or use `hub agent` from the instance): `projects/`, `data/`, `state/`, `config/` are created there.
4. Say `настрой проект <slug>`: the `project-setup` skill interviews you and writes `projects/<slug>/project.md`, then `hub dev init <slug> --apply` gives the project its own `@dev/`.
5. Keep your own decisions and plans in the instance's `@dev/` and `@docs/custom/` (a project's development plans in `projects/<slug>/@dev/`); leave core files alone, or change them with a reason that applies to every owner.

The instance pins the core in `core.version` (a tag, or a commit for a test instance that follows `main`) and moves it with `hub core update`. It runs with `<instance>/run.sh`; `HUB_HOME` is required for every command that touches data.

Where `core/` comes from: `hub core install` makes it the git submodule at the pinned commit (the default; the only state a commit or deploy may be in). `hub core dev <path> [--apply]` removes that checkout and links `core/` to a core checkout you edit (git is told to ignore `core/`, so instance commits never take the link); `hub core install` undoes it.

Custom code of an instance (its own apps and packages) lives only in `apps/` and `packages/` at the instance root and joins the core's packages in one pnpm/turbo workspace rooted at the instance (decision 0018). `hub workspace init --apply` generates the root `package.json`, `pnpm-workspace.yaml` and `turbo.json` from `core/app`; `hub workspace check` fails when they drift from the core in use (run it after `hub core update`). A core package never imports an instance package. `hub core update` refuses while linked, and `instance.core` warns that the pin is not verified.

## The guard

`app/apps/installer/test/layers.test.ts` fails when a core file (skills, `@docs/core`, `app/@rules`, `app/projects/_template`,
`app/packages`, `app/apps`, `install.sh`, shared config) matches a name in `config/custom-names.txt`: one regex per line, the
owner's private, git-ignored list (his domains, addresses, project slugs, colleagues). Without that file the guard skips; write
your own (see `config/custom-names.example.txt`) to keep your names out of core. Test fixtures use `acme`, `example.com`,
`client@example.com`. Two more checks in the same file: secrets and local config stay git-ignored, and nothing live imports retired automation.

The core placeholder for a fact the agent does not have is `[Owner: ...]`. An owner whose reply helper uses another marker is
told in his project's notes to accept both when reading.

Update this page when the architecture changes.
