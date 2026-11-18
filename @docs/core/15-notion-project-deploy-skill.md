# 15. Skill and knowledge base: deploy a ready project into Notion

Status: skill and knowledge pack built; the core modules have been deployed to a scratch page through the Notion MCP, and the pack's schemas and views diff clean against the live CRMs (decision 0019). Owner acceptance and the token-backed read-back are open in the owner's plan.

## Goal
A local skill plus a local knowledge pack from which a workflow agent, using only the Notion MCP, builds a project's CRM in a Notion teamspace by itself: databases, properties, relations, views, Help pages. No Hub installer, no human clicking. A future client who deploys our workflow gets a working Notion project from one run of `project-setup`.

## What exists now
- `skills/notion-project-deploy/SKILL.md`: preflight, inventory, dry-run plan, apply, verify, trap checklist. Rules: never delete, never touch rows, dry run first, writes ids back to `project.md`.
- `app/projects/_template/notion-crm/` (files `README`, `00` to `10`; `05` is `05-documents-business-contacts.md`; the optional Contacts module is named Business contacts, standalone and separate from Clients, owner decision 2026-11-14; the old `People` relation properties are `Clients`): the CRM distilled from Help (read live through the Notion MCP on 2026-11-14): principles and conventions, module map and creation order, properties/types/options/relations per database, views, Help page tree with placeholders, API traps. Every file has a `Source:` line with page ids and the date read. `_template` is not a project: tools listing `projects/*` skip folders that start with `_`.
- Sources behind it: the live `📘 Help` page of the owner's reference CRM (CRM overview, Modules, Guides, Deals = Opportunities, change log) and the live databases (full property and view JSON, `schema/*.json` and `views/*.json`).

## Design
1. **Knowledge pack as markdown, schema as the pack's tables.** The agent reads tables, not JSON. Machine-readable JSON per database (`schema/*.json`) and per view (`views/*.json`) is generated from the live databases (all 14) and wins over the tables; the tables carry meaning and rules.
2. **Idempotency key**: a database is found by (1) the id in `project.md`, (2) a first description line `deploy-id: <slug>/<db>` under the parent, (3) the same title under the parent (asked once, never adopted silently). No hidden property is added to the schema.
3. **Dry run first**: the plan lists CREATE / ADD / SKIP (with the trap number) / exists / differs and creates nothing until the owner says go; it covers only the printed plan.
4. **Add only**: a property, an option, a relation, a view. Differences that need a change or removal are reported. Rows are never touched. Delete and move tools are not in the skill's allow-list.
5. **Write-back**: after each database the data source id goes into `project.md` `## Notion databases`; decisions go into `## Answers`.
6. **Interview**: the core module list (Clients, Leads, Tasks, Documents) needs no questions; the skill asks once about optional modules and the vertical (real estate) options, defaults core and generic. `project-setup` step 3.3 calls this skill when the project's Notion has no databases.
7. **Verify**: the inventory is run again (0 missing), `notion-dump check` reads each database through the integration, two dumps hash identically, a second plan is empty except SKIP lines.

## Known limits (traps, in the skill's checklist and `10-api-traps.md`)
- No `status` property (use select); no cross-database formulas (skip, name in the report, no per-formula patches).
- A moved or re-created database loses its grant: the human re-shares the whole teamspace with the integration once; verify by reading one row.
- A parent page in the trash makes every child unreachable: check `in_trash` first.
- Select and multi_select options exist only when used or when the data source is updated with them: pass the full list, read back, add the missing.
- View filters need property ids: fetch the data source right before creating a view.
- The Notion MCP token's permissions and plan limits are unverified; rate limits: one database at a time.
- Formula-driven columns that need Tasks (`No task`, `Open tasks`, `Overdue tasks`, `Task due`) may stay skipped: the views that use them (No task) then fall back to the plain filters and are listed in the report.

## Drift check

The pack follows the live CRM (decision 0019). Each inventory run saves the live data-source schema and runs `notion-dump diff <slug> --live <file>`; differences are fixed in `schema/*.json` (`aliases`, `optional`, `contract`), never in the live Notion. The leads contract is `21-leads.md`.
