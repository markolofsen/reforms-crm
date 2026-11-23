---
name: project-setup
description: Use when a project is new to the Hub Workflow, has a project.md without settings, or has open setup questions. Produces projects/<slug>/project.md (schema v1 with its kind) by interviewing the owner one question at a time, then runs the project doctor. Never writes outside that project and never creates Notion structures. Unlike notion-project-deploy, which builds Notion, and knowledge-import, which fills knowledge, this only records the project's facts.
allowed-tools: Read Write Edit Bash mcp__mail-mcp__list_accounts mcp__mail-mcp__list_mailboxes mcp__notion__notion-search mcp__notion__notion-fetch mcp__hub__project_show
---

# Project setup (interview, no UI)

> Layer: **core** (universal). Project names, people and addresses in this file are examples; one owner's facts live in `projects/<slug>/` (custom). Rule: `@docs/LAYERS.md`.

Spec: `@docs/core/16-projects-and-knowledge.md` (read sections 3, 3C and 8 first).
**One project per set of mailboxes; a brand is a row.** Products whose mail reaches the same accounts (forwarded domains, aliases) are rows of `## Brands` in ONE project, never a second project: never create `<product>-support` on a mailbox another project already reads (the account claim refuses it, and it would split one client's history). You do all the work; the owner only answers.
Talk to the owner in Russian, briefly; every file is English. Never send mail. Never set or change the send policy (`send.*`, `draft.recipients`): it is `state/projects/<slug>/send-policy.json`, outside your reach, and only the owner changes it with `hub send policy set` in his own shell; never write those rows into `project.md` (they are ignored and fail the doctor). Never write a secret value, only file names. One session, one project (the binding prompt): set up only the slug named; asked for another, say to start `hub agent <other>`.

## Modes
- **new**: no `projects/<slug>/`. Go to step 1.
- **adopt**: the folder has `project.md` without `## Settings` (a folder that predates schema v1). Keep the databases list untouched; ask only for missing required fields.
- **resume**: the owner says "continue setup" or `project_questions` has an open row. Read it, ask that one question, then continue from step 5.

## Steps
1. **Read before asking.** Read `project.md` (if any), its `## Answers`, and open rows of `project_questions`. A field that has a Settings row is decided: do not ask it.
2. **Derive what you can**, silently:
   - `mail.accounts` from `list_accounts`; `mail.addresses` and `mail.sender` from those accounts' addresses.
   - Notion databases: `notion-search` for the project's teamspace, `notion-fetch` the Clients, Leads and Reports data sources (a Knowledge database, if one exists, is not used: ignore it unless the owner wants it migrated); take the `collection://` ids.
   - Quick Links, when `notion.teamspace_id` is known: `references/derive-and-files.md`.
   - `languages`, `timezone` from the host and the mail you can see.
3. **Ask, one question per message**, in this order, skipping any already decided. Each: what, why (one clause), your proposed default, at most three options.
   The questions (name and kind, Mail, brands and signatures, Notion, the Hub's Notion setup line, knowledge, tone, test mode, connectors) and their limits: `references/questions.md`. Never exceed six questions, plus the brand questions in a multi-product project and the connector question.
4. **Record after each answer, not at the end.** Write or update the Settings row (value, today's date, `By=owner` for an answer, `agent` for a derived value, `default` for a default); append one row to `## Answers`; mark the `project_questions` row `answered`.
5. **Create the files** (new): `project.md` in the layout of doc 16 section 3, the starter workflows, sequences and taxonomy, and the project's `@dev/`: `references/derive-and-files.md`. Leave `status: draft`.
6. **Run `hub project sync`, then `hub doctor --project <slug>`.** On a failed check, do not guess: report the check, then ask one correction question quoting the old answer (doc 16 section 8.6).
7. **Knowledge**: if `knowledge.source` is not `files`-only-empty, run the `knowledge-import` skill for this project.
8. **Activate**: when doctor passes, set `status: active`, `setup.doctor: <date> pass`, `setup.completed: <date>`, sync again. The recipients rule is the owner's command (`hub send policy`), never yours.
9. **Close**: read the project back with `project_show` (hub) and print one summary: project, accounts and addresses, databases found, knowledge count, defaults applied, test mode on or off, next step.

## Checks (all must hold before you say done)
- `hub dev index <slug> --check` passes (the project has its `@dev/`).
- `project.md` parses (`hub project sync` exits 0) and `setup.doctor` says `pass` with today's date.
- Every field the project's kind requires has a Settings row or a section entry (`hub project show <slug>` prints the kind and any `missing_required`); no row duplicates; dates are ISO.
- No address, account or `mail.domains` entry is also claimed by another project (sync reports it).
- With a `## Brands` table: doctor rows `brands table parses` pass, `every project domain has a brand` and `every brand has a signature` pass (or warn only while `draft`, each warning named in the summary).
- `git status` shows only `projects/<slug>/` changes from you; stage explicit paths, never `git add -A`.
- You asked each field at most once, and a question you could not ask now is one open `project_questions` row.
