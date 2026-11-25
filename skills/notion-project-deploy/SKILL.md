---
name: notion-project-deploy
description: Use when a project has no Notion CRM yet or a module of it is missing, or when the owner wants the existing structure checked. Produces a dry-run plan first, then, after the owner's go, the missing databases, relations, views and Help pages, with their ids written back into project.md. Never deletes and never touches rows. Unlike project-setup, which interviews and writes project.md, this builds what project.md describes in Notion.
allowed-tools: Read Write Edit Bash mcp__notion__notion-search mcp__notion__notion-fetch mcp__notion__notion-get-teams mcp__notion__notion-create-database mcp__notion__notion-create-pages mcp__notion__notion-create-view mcp__notion__notion-update-data-source mcp__notion__notion-update-view
---

# Deploy a project into Notion

> Layer: **core** (universal). Project names, people and addresses in this file are examples; one owner's facts live in `projects/<slug>/` (custom). Rule: `@docs/LAYERS.md`.

Design: `@docs/core/15-notion-project-deploy-skill.md`.
Knowledge: `app/projects/_template/notion-crm/` (read `README.md`, `00`, `01`, `10`, then the file of each module you deploy; `schema/<db>.json` and `views/<db>.json` exist for every database and are the contract (types, options, relations, view filters); the markdown tables carry the meaning, rules and the writer vocabulary. If a JSON `note` or `flag` (`vertical`, `ads`, `sync`, `migration`) says skip, skip it unless the interview asks. Rollups and formulas marked `trap` are skipped (trap 2) unless the API accepts them. Their ids are a live CRM's: never reuse them). Do not re-read the live Help unless a knowledge file is older than the Notion page it names; the pack is the source for structure.
Talk to the owner in Russian, briefly; every file and every Notion page you create is English. Notion MCP only: no Hub, no token in a file, never print a secret.

## Hard rules

1. **Never delete, move, archive, rename or overwrite.** The allow-list has no such tool; do not reach for one. A difference you cannot fix by adding is reported, not fixed.
2. **Never touch rows.** No page is created in a deployed database, no property of an existing row is changed. Only structure (databases, properties, options, relations, views) and the Help pages.
3. **Nothing in the owner's live CRM is a target.** The parent is the project's own teamspace page, or a scratch page the owner names. A project whose `project.md` already lists databases is a verify run, not a deploy.
4. **Dry run first, always.** Create nothing until the owner says go to the printed plan, except in a setup run where the owner already said "deploy" for this project (the go still covers only the printed plan; a changed plan needs a new go).
5. **One session, one project** (the binding prompt): work only for the project named in the phrase or `$HUB_PROJECT`; asked for a second one, refuse and say to start `hub agent <other>`.
6. Add only: a property, an option, a relation, a view. Never change a property's type or remove an option.

## Inputs

- `projects/<slug>/project.md`: name, `notion.teamspace`, `## Notion databases` (ids already known), `## Answers`.
- The module list. If the project has none recorded, derive: core = Clients, Leads, Tasks, Documents (a conversation report is a Documents row of Type Report; there is no Reports database, decision 0022) (workflows are not a Notion module: they are files, `hub workflows`) (Knowledge is not deployed by default: the knowledge base is the local `knowledge/` folder; add it only if the owner asks); ask once about the optional ones (Deals, Expenses, Business contacts; Organizations and Open loops, the legacy module `sales-legacy`, only where the owner keeps live rows); Bug reports is made by `hub install --only notion.bug-reports`, not by this skill; every database that tags a project gets `Projects` (decision 0053) and whether the vertical (real estate) options are wanted. Default: core only, generic options, no vertical. Record the answer in `## Answers` (one question per message, never re-ask; doc 16 section 8).
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

**Drift check (every inventory, existing databases):** save the fetched data-source JSON of each database to a file and run `notion-dump diff <slug> --live <file>` (decision 0019: live Notion wins over the pack). A property the live CRM has and the pack lacks, or a type the live one changed, is fixed in `schema/<db>.json` (add `aliases` for a renamed property, `optional` for one a project may omit), or recorded as the owner's choice. Never change the live database to fit the pack. Live naming: teamspace pages are Customers (Clients, Deals, and Organizations and Open loops where kept), Contacts, Archive; Leads, Tasks, Documents sit at the top level of the teamspace.

## Step 2: the plan (dry run; show it, change nothing)

Print one plan, in this order, and wait for go:

```
Parent: <title> (<url>), in_trash: false
Modules: <list>        Vertical: no        Language: en
1. CREATE database Tasks             <n> properties, <m> views
2. ADD to Clients: option "Dormant" in Activity; properties "Other emails", "Telegram", "WhatsApp"
3. SKIP (API cannot): Clients."No task" formula needs Tasks; Status is a real status property (trap 1)
4. CREATE Help pages: 4 (Help, CRM overview, Modules, Guides) + 6 module pages
5. WRITE BACK: project.md -> clients, tasks, ...
Exists unchanged: Documents
Differs, will not change: Leads.Status is type "status" (stays)
```

Every skipped item names the trap number from `10-api-traps.md`. Order of creation: `01-modules.md`.

## Step 3: apply (only after go; sequential, one database at a time)
Probe, databases without relations, relations, formulas and rollups, views, Help pages, and the write-back to `project.md` after every database: `references/apply.md`, in that order.

## Step 4: after the creation (verify)

- [ ] Re-run Step 1 against what you created: every database `exists`, properties and options match, 0 `missing`. Expected leftovers are only the items listed as SKIP in the plan.
- [ ] **Grant**: the human re-shares the whole teamspace with the hub integration, once (trap 3; what to share and why: `@docs/setup/access.md`). Say so. Then read one row (or the empty database) of each database through the integration path: `pnpm --filter @hub/notion notion-dump check <slug>`. A database the dump cannot see is a grant problem, not a deploy failure.
- [ ] `pnpm --filter @hub/notion notion-dump dump <slug>` twice: the second dump has identical hashes (idempotent read back); the schema files match the plan. (Run only as the track's acceptance or on the setup run's end, not between steps.)
- [ ] No `{{` left in any created page; no page you created sits outside the parent.
- [ ] Run Step 2 again: the plan must be empty except SKIP lines (a second run changes nothing).

## Report (print at the end, brief)

Created / existed / differs / skipped (with trap numbers); data source ids written; the sentence "re-share the teamspace with the integration" until the owner confirms it; next step (`project-setup` continues, or the owner reviews).

## Trap checklist
Every run: copy `references/traps.md` into the working notes and tick each item.
