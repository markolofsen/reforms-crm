# Instance (custom layer)

This folder is one business owner's **instance** of Hub Workflow: data only, no code. The core (skills, `hub` CLI, `@docs/core`, rules) lives in
its own repository; `hub agent` starts the session here with `HUB_HOME` set and the core skills linked into `.claude/skills/`.

- Binding, draft-only rules and the report format are the core's `AGENTS.md`; the skills are the core's `skills/`. Read them from the core checkout named in `core.version`; do not copy them here.
- What the session knows at start is the core's system prompt (`hub agent`), not this file: the binding, the shared-focus rules (P51) and the tools.
- One session, one project: `projects/<slug>/project.md`. Never read another project's folder.
- Never edit core from here. Never put a token, a password or a state file in a tracked path.
- The core version is stated only in `core.version`.
