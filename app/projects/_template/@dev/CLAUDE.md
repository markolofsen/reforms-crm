# `@dev` of {{SLUG}}: kanban for this project's development

Read this and `README.md` before adding or moving a track. Layer: **custom** (this owner's project; not shipped to other owners). Work on the Hub itself is not here: it goes in the Hub's own `@dev`.

- The directory is the status: `active/` (an agent can advance it today), `blocked/` (names the blocker and who), `planned/` (approved, not started), `completed/` (with acceptance evidence), `_archive/` (parked, with the reason). `decisions/` holds one short file per durable decision, `research/` investigations that are not yet a track.
- A track is a directory with one `PLAN.md`: Purpose, Status, Owner, Next action, Blockers, Acceptance evidence.
- Promote with `git mv`. The track table in `README.md` is generated from the directories and each plan's `Owner:` and `Next action:` lines: run `hub dev index {{SLUG}}` after a move or an edit. `hub dev index {{SLUG}} --check` exits 1 on drift. Do not edit the table by hand.
- A plan's `Status:` starts with ACTIVE, BLOCKED, PLANNED, DONE or PARKED and must agree with its directory.
- English, kebab-case, absolute dates. Nothing is deleted: abandoned means PARKED in `_archive/` with the reason.
- One writer per set of files. Read the track's `PLAN.md` first and update it before you stop.
- Run builds and tests once, at the end of the task, never between edits.
- When the project's facts change (accounts, addresses, databases, workflows, sender), update `../project.md` and every plan that names them in the same change. A page that lists the project's architecture ends with "Update this page when the architecture changes."
