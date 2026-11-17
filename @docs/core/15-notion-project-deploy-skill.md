# 15. Skill and knowledge base: deploy a ready project into Notion

Status: skill and knowledge pack written 2026-11-14 (documents only, nothing run); work packages and acceptance below. Owner ask 2026-11-14.

## Goal
A local skill plus a local knowledge pack from which a workflow agent, using only the Notion MCP, builds a project's CRM in a Notion teamspace by itself: databases, properties, relations, views, Help pages. No Hub installer, no human clicking. A future client who deploys our workflow gets a working Notion project from one run of `project-setup`.

## What exists now
- `skills/notion-project-deploy/SKILL.md`: preflight, inventory, dry-run plan, apply, verify, trap checklist. Rules: never delete, never touch rows, dry run first, writes ids back to `project.md`.
- `app/projects/_template/notion-crm/` (files `README`, `00` to `10`; `05` is `05-reports-documents-business-contacts.md`; the optional Contacts module is named Business contacts, standalone and separate from Clients, owner decision 2026-11-14; the old `People` relation properties are `Clients`): the CRM distilled from Help (read live through the Notion MCP on 2026-11-14): principles and conventions, module map and creation order, properties/types/options/relations per database, views, Help page tree with placeholders, API traps. Every file has a `Source:` line with page ids and the date read. `_template` is not a project: tools listing `projects/*` skip folders that start with `_`.
- Sources behind it: the live `📘 Help` page of the owner's reference CRM (CRM overview, Modules, Guides, Deals = Opportunities, change log), the live Leads and Tasks databases (full property and view JSON), the owner's instance docs (P2), and the Hub installer's definitions (in the old Hub repo, not yet diffed).

## Design
1. **Knowledge pack as markdown, schema as the pack's tables.** The agent reads tables, not JSON. Machine-readable JSON per database (`schema/*.json`) and per view (`views/*.json`) is generated from the live databases (W2, done for all 14) and wins over the tables; the tables carry meaning and rules.
2. **Idempotency key**: a database is found by (1) the id in `project.md`, (2) a first description line `deploy-id: <slug>/<db>` under the parent, (3) the same title under the parent (asked once, never adopted silently). No hidden property is added to the schema.
3. **Dry run first**: the plan lists CREATE / ADD / SKIP (with the trap number) / exists / differs and creates nothing until the owner says go; it covers only the printed plan.
4. **Add only**: a property, an option, a relation, a view. Differences that need a change or removal are reported. Rows are never touched. Delete and move tools are not in the skill's allow-list.
5. **Write-back**: after each database the data source id goes into `project.md` `## Notion databases`; decisions go into `## Answers`.
6. **Interview** (links with p7): the core module list needs no questions; the skill asks once about optional modules and the vertical (real estate) options, defaults core and generic. `project-setup` step 3.3 calls this skill when the project's Notion has no databases.
7. **Verify**: the inventory is run again (0 missing), `notion-dump check` reads each database through the integration, two dumps hash identically, a second plan is empty except SKIP lines.

## Known limits (traps, in the skill's checklist and `10-api-traps.md`)
- No `status` property (use select); no cross-database formulas (skip, name in the report, no per-formula patches).
- A moved or re-created database loses its grant: the human re-shares the whole teamspace with the integration once; verify by reading one row.
- A parent page in the trash makes every child unreachable: check `in_trash` first.
- Select and multi_select options exist only when used or when the data source is updated with them: pass the full list, read back, add the missing.
- View filters need property ids: fetch the data source right before creating a view.
- The Notion MCP token's permissions and plan limits are unverified (a decision or plan record kept in the owner's instance); rate limits: one database at a time.
- Formula-driven columns that need Tasks (`No task`, `Open tasks`, `Overdue tasks`, `Task due`) may stay skipped: the views that use them (No task) then fall back to the plain filters and are listed in the report.

## Work packages (track a decision or plan record kept in the owner's instance)

| WP | Work | Done when |
|---|---|---|
| W1 | Skill and knowledge pack: written 2026-11-14 | files exist; owner has read them |
| W2 (done 2026-11-14: all 14 databases incl. Payments) | Capture machine-readable JSON from the live CRM: `schema/<db>.json` per database (properties, options, relations, descriptions) and `views/<db>.json` (full view JSON) for the five core and Tasks, by `notion-fetch` per data source and per view; read-only; vertical options flagged. Diff against the Hub installer and the owner's instance docs; fix the pack where they disagree | each core database has both files; diff list in the plan; pack corrected |
| W3 (done 2026-11-14) | Fill gaps found in W1: Deals `Stage` list (25 options), Clients/Deals/Open loops view filters, Workflows view list, Organizations and Open loops property types | no "not read" line left in `08-views.md` and `02-sales.md` |
| W4 (done 2026-11-14; the page id is in the track plan) | Scratch page (one empty Notion page, outside every CRM teamspace) | page url recorded in the plan |
| W5 | Deploy test 1: `_template` with module Knowledge (no relations) to the scratch page; verify; `notion-dump check` and two dumps | verify 0 missing; dumps identical |
| W6 | Deploy test 2: the rest of the core (Clients, Leads, Tasks, Reports) incl. relations, views, Help pages; verify; re-run to prove idempotency | second run's plan has only SKIP lines; no duplicate database |
| W7 | Trap rehearsals on the scratch page: trashed parent (must stop), a lost grant (must say re-share), a missing select option (must be added), a view by property id | each rehearsal recorded pass in the plan |
| W8 | Close out: owner reviews the dry-run output on a fresh project (`project-setup` -> deploy); update `10-owner-log`-style notes; mark the track completed | owner says accepted; track moved to a decision or plan record kept in the owner's instance |

## Acceptance
1. Deploying the template (core modules) to a scratch page on the owner's Notion creates the databases, relations, views and Help pages; the second plan is empty except SKIP lines; no database is duplicated; nothing is deleted.
2. The dump command reads the deployed databases back: `notion-dump check <scratch project>` passes and two `notion-dump dump` runs have identical per-database hashes; the `schema.json` of each dumped database matches the plan (types and options; SKIP items absent).
3. The owner's live CRMs were not written to at any point: the track's runs show writes only under the scratch page.
4. An agent with only the Notion MCP and the skill does all of this without reading the live Help (the pack is enough).

Depends on: p2 (the dump and the owner's instance docs, done), the owner's scratch page (W4), P0 for a token only if run through `claude -p`.

W5/W6 (2026-11-14): the six core modules were deployed to the scratch page through the MCP; the project reads its parent from `notion.parent_page`. Outdated traps 1 and 6 are corrected in `10-api-traps.md`. `notion-dump` needs a token (blocked).

## Drift check (2026-11-17)

The pack follows the live CRM (decision 0019). Each inventory run saves the live data-source schema and runs `notion-dump diff <slug> --live <file>`; differences are fixed in `schema/*.json` (`aliases`, `optional`, `contract`), never in the live Notion. The leads contract is `21-leads.md`.
