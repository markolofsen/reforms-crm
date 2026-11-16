---
name: notion-project-deploy
description: Use when a project has no Notion CRM yet or a module of it is missing, or when the owner wants the existing structure checked. Produces a dry-run plan first, then, after the owner's go, the missing databases, relations, views and Help pages, with their ids written back into project.md. Never deletes and never touches rows. Unlike project-setup, which interviews and writes project.md, this builds what project.md describes in Notion.
allowed-tools: Read Write Edit Bash mcp__notion__notion-search mcp__notion__notion-fetch mcp__notion__notion-get-teams mcp__notion__notion-create-database mcp__notion__notion-create-pages mcp__notion__notion-create-view mcp__notion__notion-update-data-source mcp__notion__notion-update-view
---

# Deploy a project into Notion

> Layer: **core** (universal). Project names, people and addresses in this file are examples; one owner's facts live in `app/projects/<slug>/` (custom). Rule: `@docs/LAYERS.md`.

Design: `@docs/core/15-notion-project-deploy-skill.md`. Plan and acceptance: a decision or plan record kept in the owner's instance.
Knowledge: `app/projects/_template/notion-crm/` (read `README.md`, `00`, `01`, `10`, then the file of each module you deploy; `schema/<db>.json` and `views/<db>.json` exist for every database and are the contract (types, options, relations, view filters); the markdown tables carry the meaning, rules and the writer vocabulary. If a JSON `note` or `flag` (`vertical`, `ads`, `sync`, `migration`) says skip, skip it unless the interview asks. Rollups and formulas marked `trap` are skipped (trap 2) unless the API accepts them. Their ids are a live CRM's: never reuse them). Do not re-read the live Help unless a knowledge file is older than the Notion page it names; the pack is the source for structure.
Talk to the owner in Russian, briefly; every file and every Notion page you create is English. Notion MCP only: no Hub, no token in a file, never print a secret.

## Hard rules

1. **Never delete, move, archive, rename or overwrite.** The allow-list has no such tool; do not reach for one. A difference you cannot fix by adding is reported, not fixed.
2. **Never touch rows.** No page is created in a deployed database, no property of an existing row is changed. Only structure (databases, properties, options, relations, views) and the Help pages.
3. **Nothing in the owner's live CRM is a target.** The parent is the project's own teamspace page, or a scratch page the owner names. A project whose `project.md` already lists databases is a verify run, not a deploy.
4. **Dry run first, always.** Create nothing until the owner says go to the printed plan, except in a setup run where the owner already said "deploy" for this project (the go still covers only the printed plan; a changed plan needs a new go).
5. **One session, one project** (`skills/README.md` Rules, item 2): work only for the project named in the phrase or `$HUB_PROJECT`; asked for a second one, refuse and say to start `hub agent <other>`.
6. Add only: a property, an option, a relation, a view. Never change a property's type or remove an option.

## Inputs

- `app/projects/<slug>/project.md`: name, `notion.teamspace`, `## Notion databases` (ids already known), `## Answers`.
- The module list. If the project has none recorded, derive: core = Clients, Leads, Tasks, Reports, Workflows (Knowledge is not deployed by default: the knowledge base is the local `knowledge/` folder; add it only if the owner asks); ask once about the optional ones (Deals/Organizations/Open loops/Participants, Documents, Expenses, Business contacts) and whether the vertical (real estate) options are wanted. Default: core only, generic options, no vertical. Record the answer in `## Answers` (one question per message, never re-ask; doc 16 section 8).
- The parent page: `notion.parent_page` (a page id, wins), else `notion.teamspace` (search), else ask for the page URL, one question.

## Step 0: access and preflight (checklist, in order; stop at the first failure)

- [ ] `notion-get-teams` / `notion-search` answers (the MCP is connected and authorised). If not: say which, stop.
- [ ] **Parent exists and is not in the trash.** `notion-fetch` the parent: it must resolve, and `in_trash` / archived must be false. A trashed parent makes every child unreachable (404): never create under it; tell the owner to restore it.
- [ ] The parent is in the project's teamspace (ancestor path), not the owner's live CRM of another project (the owner's live schema notes in the custom layer list the roots) unless this project is that one and the run is a verify.
- [ ] The Notion plan allows what you need (creating databases through the MCP). The first write is a harmless page (see Apply, step 1); if it is refused, stop and report the exact error.
- [ ] `project.md` parses (`## Notion databases` items are `- slug: <data source id>`; outside that heading no `- key: value` list items).

## Step 1: inventory (read-only)

For each module database in scope, find out whether it exists, in this order:
1. The id in `project.md`: `notion-fetch collection://<id>`. Resolves = exists; 404 = lost grant or gone (do not recreate; see trap 3, report "unreachable").
2. A database under the parent whose description starts with `deploy-id: <slug>/<db>` (the marker this skill writes).
3. A database under the parent with the same title (an unmarked, hand-made one). Ask once whether it is the one; never adopt silently.

For each existing database fetch the data source and compare with the knowledge file: missing properties, missing select options, wrong types (report only), missing relations, missing views, missing marker. Also list which Help pages exist (title match under the project's `📘 Help`).
Result: a table, per database: `exists` / `missing` / `differs (what)`.

## Step 2: the plan (dry run; show it, change nothing)

Print one plan, in this order, and wait for go:

```
Parent: <title> (<url>), in_trash: false
Modules: <list>        Vertical: no        Language: en
1. CREATE database Tasks             <n> properties, <m> views
2. ADD to Clients: option "Dormant" in Activity; property "Other emails"
3. SKIP (API cannot): Clients."No task" formula needs Tasks; Status is a real status property (trap 1)
4. CREATE Help pages: 4 (Help, CRM overview, Modules, Guides) + 6 module pages
5. WRITE BACK: project.md -> clients, tasks, ...
Exists unchanged: Reports, Workflows
Differs, will not change: Leads.Status is type "status" (stays)
```

Every skipped item names the trap number from `10-api-traps.md`. Order of creation: `01-modules.md`.

## Step 3: apply (only after go; sequential, one database at a time)

1. **Probe**: create one scratch page `Deploy check {{deploy_id}}` under the parent; fetch it back. If it fails, stop. Leave it (rule 1: the owner deletes it).
2. **Databases without relations**, in the order of `01-modules.md`. For each: `notion-create-database` with title (emoji icon as in the knowledge file), every property of the module file with type, select/multi_select options (the full list, trap 5), and for every property a **description starting with its writer** (`00-principles.md`). Types: `Status` is created as a real `STATUS` with its groups (trap 1, outdated); formulas: same-database ones only (trap 2). Relations: add ONE side of a self-relation (trap 14). Put `deploy-id: <slug>/<db>` as the first line of the database description. Then `notion-fetch` the data source and compare with what you asked: a missing option is added with `notion-update-data-source`. Record the **data source id** at once.
3. **Relations**, second pass, once both ends exist: add each relation property with `notion-update-data-source`, with the target data source id; two-way where the file says so; limit 1 on the "belongs to one" side. Fetch back and check the reverse property exists.
4. **Formulas and rollups** that need Tasks: rollups through the relation if the API accepts them; cross-database formulas skipped (trap 2).
5. **Views**: for each database `notion-fetch` the data source, take the property ids, build each view from `views/<db>.json` with the name-based view DSL (trap 6, outdated) — `NOT IN` is refused, use `!=` pairs; the default view is renamed and becomes the first working list. Read the created view back.
6. **Help pages** (`09-help-pack.md`): create `📘 Help`, then `CRM overview`, `Modules`, `Guides` and the module pages of the deployed modules, then the guides; fill placeholders; module Fields and Views tables are generated from the knowledge files of the modules deployed. Link database mentions with the live urls.
7. **Write back to `project.md`** after every database (not at the end): the data source id under `## Notion databases` (`- <slug>: <id>`), `notion.teamspace`, and a row in `## Answers` for each decision (date, field, question, answer). Keep the file parsable: do not add `- key: value` items elsewhere. Stage only `app/projects/<slug>/project.md`.
8. If a step fails: stop, write what exists to project.md, report the failed step and the exact error. Do not retry a create twice (a duplicate database is worse than a missing one): re-run the inventory first.

## Step 4: after the creation (verify)

- [ ] Re-run Step 1 against what you created: every database `exists`, properties and options match, 0 `missing`. Expected leftovers are only the items listed as SKIP in the plan.
- [ ] **Grant**: the human re-shares the whole teamspace with the integration (Connections), once (trap 3). Say so. Then read one row (or the empty database) of each database through the integration path: `pnpm --filter @hub/notion notion-dump check <slug>`. A database the dump cannot see is a grant problem, not a deploy failure.
- [ ] `pnpm --filter @hub/notion notion-dump dump <slug>` twice: the second dump has identical hashes (idempotent read back); the schema files match the plan. (Run only as the track's acceptance or on the setup run's end, not between steps.)
- [ ] No `{{` left in any created page; no page you created sits outside the parent.
- [ ] Run Step 2 again: the plan must be empty except SKIP lines (a second run changes nothing).

## Report (print at the end, brief)

Created / existed / differs / skipped (with trap numbers); data source ids written; the sentence "re-share the teamspace with the integration" until the owner confirms it; next step (`project-setup` continues, or the owner reviews).

## Trap checklist (every run, copy into the working notes and tick)

- [ ] Parent `in_trash` checked before anything (trap 4).
- [ ] Status columns are `status` properties (trap 1); the DDL differences of trap 15 are listed as `differs`.
- [ ] Cross-database formulas skipped with a caveat in the report, not patched one by one (trap 2).
- [ ] A moved or re-created database loses its grant: teamspace re-shared, one row read (trap 3).
- [ ] Select and multi_select options passed in full and read back; missing ones added with `notion-update-data-source` (trap 5).
- [ ] View filters built from property ids fetched in this run (trap 6).
- [ ] Sequential creates, one retry policy, no duplicate on retry (trap 10).
- [ ] `project.md` lists data source ids, not database ids (trap 11).
- [ ] Nothing deleted, nothing moved, no row touched.
