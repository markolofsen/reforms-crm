---
name: project-setup
description: Use when a project is new to the Hub Workflow, has a project.md without settings, or has open setup questions. Produces projects/<slug>/project.md (schema v1 with its kind) by interviewing the owner one question at a time, then runs the project doctor. Never writes outside that project and never creates Notion structures. Unlike notion-project-deploy, which builds Notion, and knowledge-import, which fills knowledge, this only records the project's facts.
allowed-tools: Read Write Edit Bash mcp__mail-mcp__list_accounts mcp__mail-mcp__list_mailboxes mcp__notion__notion-search mcp__notion__notion-fetch
---

# Project setup (interview, no UI)

> Layer: **core** (universal). Project names, people and addresses in this file are examples; one owner's facts live in `projects/<slug>/` (custom). Rule: `@docs/LAYERS.md`.

Spec: `@docs/core/16-projects-and-knowledge.md` (read sections 3 and 8 first). You do all the work; the owner only answers.
Talk to the owner in Russian, briefly; every file is English. Never send mail. Never set or change any `send.*` setting: `send.mode` stays `draft`, and only the owner changes it, in the admin. Never write a secret value, only file names. One session, one project (`skills/README.md` Rules, item 2): set up only the slug named; asked for another, say to start `hub agent <other>`.

## Modes
- **new**: no `projects/<slug>/`. Go to step 1.
- **adopt**: the folder has `project.md` without `## Settings` (a folder that predates schema v1). Keep the databases list untouched; ask only for missing required fields.
- **resume**: the owner says "continue setup" or `project_questions` has an open row. Read it, ask that one question, then continue from step 5.

## Steps
1. **Read before asking.** Read `project.md` (if any), its `## Answers`, and open rows of `project_questions`. A field that has a Settings row is decided: do not ask it.
2. **Derive what you can**, silently:
   - `mail.accounts` from `list_accounts`; `mail.addresses` and `mail.sender` from those accounts' addresses.
   - Notion databases: `notion-search` for the project's teamspace, `notion-fetch` the Clients, Leads and Reports data sources (a Knowledge database, if one exists, is not used: ignore it unless the owner wants it migrated); take the `collection://` ids.
   - `languages`, `timezone` from the host and the mail you can see.
3. **Ask, one question per message**, in this order, skipping any already decided. Each: what, why (one clause), your proposed default, at most three options.
   1. Name and slug (propose from the domain or teamspace; slug is `[a-z0-9-]+`; a later change is `hub project rename <old> <new>`, never a hand-moved folder). Then the **kind**: run `./run.sh project kinds`, pick the one that fits what the owner described (default `generic`), and confirm it in the same message as a proposal, not a separate question. The kind decides which fields are required (a `shop` needs no Notion databases, a `sales-pipeline` also needs `leads`) and which modules `doctor` checks. A project that fits none stays `generic`; do not invent a kind (adding one is a code change, doc 16 section 3A).
   2. Mail: confirm the derived accounts, addresses and sender; ask for form-lead and alias addresses only if the owner has them.
   3. Notion: confirm the found databases; if none exist, say so and offer to run the `notion-project-deploy` skill, then continue.
   4. Knowledge: it is a folder of Markdown files (`knowledge/files/`), edited by hand and searched locally; nothing to choose. Ask about an old Notion Knowledge database only when `notion-search` in step 2 found one; otherwise ask only whether there are documents to bring in once. If the owner says yes, plan one migration with `knowledge-import`; Notion is not read again afterwards. Record `knowledge.source` = `files`.
   5. Tone: one line ("warm, brief, no exclamation marks"); offer 2 examples as options.
   6. Test mode: "drafts only to your own addresses until you say otherwise?" Default yes (`draft.recipients: test`).
   Never exceed six questions. Optional fields (`timezone`, `mail.mailboxes`, `run.*`, `signoff`, `notion.token_file`, `calendar.*`) take their defaults and are shown once at the end.
4. **Record after each answer, not at the end.** Write or update the Settings row (value, today's date, `By=owner` for an answer, `agent` for a derived value, `default` for a default); append one row to `## Answers`; mark the `project_questions` row `answered`.
5. **Create the files** (new): `projects/<slug>/project.md` in the layout of doc 16 section 3, with the `kind` row right after `schema` (`By=owner` if the owner chose it, `default` for `generic`), `knowledge/files/` empty. Copy the starter workflows: `cp -R app/projects/_template/workflows projects/<slug>/workflows` (ten Draft playbooks the project then owns; none is picked by an agent until the owner sets `status: Active`; `hub workflows list <slug>`). Copy the starter follow-up sequences the same way: `cp -R app/projects/_template/sequences projects/<slug>/sequences` (two Draft files; the owner enrols clients in the admin; `hub sequences check <slug>`). Copy the kind's starting taxonomy: `./run.sh project kinds <kind>` prints it as JSON; write its `audiences`, `category` and `stages` as `## <axis>` sections of `knowledge/taxonomy.md` (format: doc 16 section 5, "Taxonomy"; skip an empty axis). The project owns the file from then on. Then `./run.sh dev init <slug> --apply`: the project's own `@dev/` kanban for its development plans (dry run first; it never overwrites). Leave `status: draft`. Outside `## Notion databases` write no `- key: value` list items.
6. **Run `./run.sh project sync`, then `./run.sh doctor --project <slug>`.** On a failed check, do not guess: report the check, then ask one correction question quoting the old answer (doc 16 section 8.6).
7. **Knowledge**: if `knowledge.source` is not `files`-only-empty, run the `knowledge-import` skill for this project.
8. **Activate**: when doctor passes, set `status: active`, `setup.doctor: <date> pass`, `setup.completed: <date>`, sync again. Never set `draft.recipients: any` yourself; only on the owner's explicit yes.
9. **Close**: print one summary: project, accounts and addresses, databases found, knowledge count, defaults applied, test mode on or off, next step.

## Checks (all must hold before you say done)
- `./run.sh dev index <slug> --check` passes (the project has its `@dev/`).
- `project.md` parses (`./run.sh project sync` exits 0) and `setup.doctor` says `pass` with today's date.
- Every field the project's kind requires has a Settings row or a section entry (`./run.sh project show <slug>` prints the kind and any `missing_required`); no row duplicates; dates are ISO.
- No address or account is also claimed by another project (sync reports it).
- `git status` shows only `projects/<slug>/` changes from you; stage explicit paths, never `git add -A`.
- You asked each field at most once, and a question you could not ask now is one open `project_questions` row.
