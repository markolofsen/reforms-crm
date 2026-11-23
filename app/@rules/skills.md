# Dev-time and run-time skills

| Kind | Who uses it | Where it lives |
|---|---|---|
| Run-time (triage, reply, profiles, reports) | the workflow agent | `reforms-crm/skills/`; index [`skills/README.md`](../../skills/README.md) |
| Dev-time (`coss`, `coss-particles`) | an agent changing `app/` | installed globally from `cosscom/ui` with the `skills` CLI; referenced here, never copied |

- A copy of a dev-time skill goes stale; reinstall with the `skills` CLI on a new machine. Pin one only by vendoring a snapshot into `app/@rules/vendor/<name>/` with its upstream commit.
- Run-time skills never move into `@rules/`: rules constrain code, skills are what the agent does.
- A skill's `description` states the situation, the result and the boundary (no phrase list, at most one example); names never change; `allowed-tools` names only real tools and every tool the body uses; a `SKILL.md` is at most 10 KB. Checked by `skills-descriptions.test.ts` and `skills-lint.test.ts`.
