---
name: status
description: Use when the owner wants to know whether one project is set up and working. Runs the project doctor and prints each failing row with its fix line. Read only, changes nothing. Unlike owner-inbox, which lists what the owner must decide, this reports the health of the setup.
allowed-tools: Read Bash
---

# Status (project health, read only)

> Layer: **core** (universal). Names in this file are examples; one owner's facts live in `projects/<slug>/` (custom). Rule: `@docs/LAYERS.md`.

Rules: `skills/README.md` ("Rules"). Talk to the owner in Russian, briefly.

1. **Bind** as `skills/triage-mail/SKILL.md` section 0 (slug from the phrase or `$HUB_PROJECT`; one project per session; asked for another: say to start `hub agent <other>`). No slug and several projects: list the names and ask.
2. Run once: `./run.sh doctor --project <slug>`. It changes nothing. Do not run `setup`, `install` or any fix yourself.
3. Report the rows. All pass: one line "<slug>: всё в порядке". Otherwise: a table `что | статус | что сделать`, failures first, the fix line copied from the doctor output; end with the single most important next step as a sentence the owner can say or run.
4. A project without `## Settings` in `project.md`: say "проект не настроен, скажи: настрой проект <slug>".
