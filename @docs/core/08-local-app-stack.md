# 08. Stack of the local admin app

Status: implemented (2026-11-15, `app/`; the stack below is the one in use). Originally a proposal, owner 2026-11-14 (language decided: TypeScript everywhere). Pairs with `06`.

## Language: TypeScript only
The app is local, so there is no reason to keep a second language. One toolchain (Node + pnpm), one set of types from the database to the screen.
- UI: Next.js 16 (App Router, Turbopack) + React 19 + Tailwind v4 + coss ui (skills `coss`, `coss-particles`). Routing: real paths with the framework's typed routes under our own typed layer (`src/routes`, `src/hooks`, `AppLink`; decisions 0014 and 0015). Server and client: route files are thin server components, every screen is a client component, and the browser reaches the API through a same-origin rewrite of `/api`; no Server Actions, no database in the Next app. `hub up` serves a production build (`next build`, replayed from the turbo cache when nothing changed, then `next start -H 127.0.0.1`) on port 5173 (`HUB_ADMIN_PORT`); the hot-reload loop is `pnpm live` (`next dev` in a worktree); e2e serves its own production build from its own directory.
- Server: small local API (Hono, decided in 0001) on 127.0.0.1. It exposes the mail and knowledge tools to the UI and runs them for the agent.
- Storage: SQLite 3, one file `data/app.db` under the instance root, WAL, `foreign_keys=ON`.

## Where files live (`HUB_HOME`)

Every location comes from one function, `hubPaths()` in `@hub/config/paths`. Nothing else joins a repo root onto `projects`, `state`, `config`, `.claude/skills` or `data` (a gate test fails on new direct joins).

- `HUB_HOME` is required for every command that reads or writes data (agent, up, doctor, install, setup, project, projects, record-*, send, audit-run, batch-check, guard, token, uninstall, core update). Unset, they exit 2: "HUB_HOME is not set: run ./run.sh from an instance folder, or export HUB_HOME". `--help`, `docs`, `test`, `link` and `guide` work without it. It must be an existing folder other than the core checkout: `<home>/projects`, `<home>/data/app.db`.
- Always under the home: `state/` (evidence, `guard.log`, `secrets/`), `config/`, `.mcp.json`, `.claude/skills`. Always under the core: `skills/`, the project template, the `hub` binary, MCP defaults.
- Precedence: `HUB_PROJECTS`, `HUB_DB`, `HUB_CONFIG_DIR`, `HUB_CONFIG_FILE` beat the home-derived default; `HUB_LEDGER_ROOT` still overrides the ledger root; an explicit `home`/`core` option beats the environment. With only `HUB_PROJECTS` set, state now sits under `<home>/state` (it used to derive from the projects folder).
- An instance states the core version it runs on in ONE file, `<home>/core.version` (first non-comment line: a core commit or tag). `hub doctor` (step `instance.core`, read-only, only when `HUB_HOME` is set) fails when the file is missing, when the core in use is not that commit or has uncommitted changes, when a core file (`app/apps`, `app/packages`, `skills`, `@docs/core`, `install.sh`, ...) is inside the instance, when the core tracks an instance file (a project folder other than the template, `@dev`, `@docs/custom`, `@refs`), or when a generated skill link dangles. While the core is still a folder inside another repository the pin check is a warning.
- An instance moves to another core version with `hub core update` (HUB_HOME set): no argument lists the `vX.Y.Z` tags of the core and the one in use; `hub core update <tag>` shows the plan; `--apply` checks the tag out in `core/`, rewrites the pin in `core.version` and runs the `instance.core` check, and puts everything back when that check fails. It never commits: commit `core/` and `core.version` together, in one commit. Going to an older tag is a rollback and is reported as one. Instances update independently of each other. A test instance may follow the core's `main` instead of a tag: `hub core update --branch main --apply` checks out the tip of `origin/main`, pins that commit in `core.version` and marks it with a `# follows: main` comment; the next tag pin removes the mark. A real-business instance stays on tags.
- In an instance `hub agent` runs claude in `<home>`, sets `HUB_HOME` in the child, links the core skills into `<home>/.claude/skills`, and gives stdio MCP servers absolute core paths plus `HUB_HOME`.
- ORM: Drizzle ORM over `better-sqlite3`, behind an async repository layer (decision a decision or plan record kept in the owner's instance, 2026-11-14; libsql is the fallback).
- MCP: the official `@modelcontextprotocol/sdk` (TypeScript). The mail conversion lives in `app/packages/mail` (fixtures in `test/fixtures`).
- Tests: Vitest (unit, and the rules test of `app/@rules`); Playwright with axe for the screens; fixtures from `app/packages/mail/test/fixtures`.

## What lives in SQLite (working state only)
Client marks, bulk queue, draft status (ready / hold / checked / done / sent log), profile index cache, and two new tables:
- `agent_runs` and `agent_events`: the action log (see `10`). Mail is read live, Notion stays the CRM; both can be rebuilt (dump, `07`).

## Rules for agents who change the app
`app/@rules/`.

## Monorepo (owner, 2026-11-14)
Turborepo + pnpm workspaces, best practices. Domains are packages, so each can be tested and replaced alone:
- `apps/admin` (Next.js + React + coss), `apps/server` (Hono API + MCP over HTTP), `apps/installer` (CLI).
- `packages/db` (Drizzle schema, migrations, repositories), `packages/mail` (read-only IMAP history; the mail-to-markdown converter is archived), `packages/notion` (direct Notion dump and restore; the daily schedule is archived), `packages/messengers` (Telegram etc.; see `13`), `packages/agent-log` (runs/events), `packages/send` (the Mailer and the send checks, `16` section 3B), `packages/notify` (sound + banners), `packages/mcp-tools` (the six tools of `05`), `packages/config` (tsconfig, eslint, shared types).
- Rules: packages never import from apps; one public entry per package; the UI talks only to the server; internal packages use TypeScript project references; Turbo pipeline `build`, `test`, `lint`, `typecheck` cached.
