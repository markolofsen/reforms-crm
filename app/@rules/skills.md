# Skills for changing the app (dev-time) vs skills the agent runs (run-time)

Two kinds, kept apart on purpose:

| Kind | Who uses it | Where it lives |
|---|---|---|
| Run-time: triage, reply, profile enrichment, reports | the workflow agent, every run | `reforms-crm/skills/` (part of the workflow, versioned here) |
| Dev-time: how to build UI with coss | an agent changing `app/` | installed globally from upstream; listed here, not copied |

## Dev-time skills: reference, do not copy
- `coss`, `coss-particles`: from https://github.com/cosscom/ui (installed via the `skills` CLI, global scope, symlinked to Claude Code under `~/.agents/skills/`).
- Why not copied into this folder: upstream changes (the skill itself says Sheet became Drawer); a copy goes stale and then misleads. One source, installed per machine.
- Re-install or update on a new machine: run the `skills` CLI with `cosscom/ui` and pick `coss` and `coss-particles`.
- What this folder adds on top is only our constraints (`README.md` in this folder): no dialogs for primary work, drafts only, English, SQLite as working state.
- Pointers inside the upstream skill: components docs `apps/ui/content/docs/components/*.mdx`, particles `apps/ui/registry/default/particles/p-*.tsx`, catalogue https://coss.com/ui/particles, agent map https://coss.com/ui/llms.txt.

## Run-time skills
Stay in `skills/`, next to `config/` and `app/`: they are the workflow, and they change with it. Each skill file names the tools it calls (`allowed-tools`) and the state it writes. Do not move them into `@rules/`: rules constrain how code changes, skills are what the agent does. Which skill does what, and its boundary: the one index, [`skills/README.md`](../../skills/README.md).

A skill's frontmatter `description` states the situation it serves, the result and the boundary: no list of quoted phrases, at most one example, no Cyrillic phrase list (`skills-descriptions.test.ts`); skill names never change. `allowed-tools` names only tools that exist and every tool the body names; a `SKILL.md` is at most 10 KB, rare branches in `references/` (`skills-lint.test.ts`, P129 verdict 9).

## If a dev-time skill must be pinned
Only then vendor a snapshot into `app/@rules/vendor/<name>/` with the upstream commit in a `SOURCE` file and a re-sync date; otherwise leave it global.
