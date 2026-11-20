# Notion setup

One place for everything about the Notion side of an instance: what the CRM in Notion consists of, which fields each database has, how to connect it, how to build it in a fresh teamspace.

| You want | Read |
|---|---|
| Every database and every field, with type, writer and options | [`fields.md`](fields.md) (generated; do not edit) |
| What a module is for, its rules, its views, the Help page tree | the knowledge pack: [`app/projects/_template/notion-crm/`](../../app/projects/_template/notion-crm/README.md), files `00` to `10` |
| The machine-readable contract (types, options, relations, view filters) | the pack's `schema/<db>.json` and `views/<db>.json` |
| How an agent deploys it | [`skills/notion-project-deploy/SKILL.md`](../../skills/notion-project-deploy/SKILL.md) and [`../core/15-notion-project-deploy-skill.md`](../core/15-notion-project-deploy-skill.md) |

The pack is a snapshot of one live CRM (`📘 Help`), distilled and made generic. Notion wins where they disagree; refresh the pack when the live Help's `Changes` list grows.

## Set Notion up for an instance

1. **Teamspace.** Make a teamspace for the project (or pick a parent page). Record its name in `projects/<slug>/project.md` as `notion.teamspace`, or a page id as `notion.parent_page` (it wins).
2. **Access.** The Claude Notion connector (no token) is what a session writes with; the hub's read integration (a token, shared with the whole teamspace) is what the local app, `notion-dump` and the doctor read with. Which credential goes to what, and what to share: [`../setup/access.md`](../setup/access.md).
3. **Build the databases.** `./run.sh project setup <slug>` interviews you once; when the project's Notion has no databases it hands over to the `notion-project-deploy` skill. That skill makes a dry-run plan (CREATE / ADD / SKIP / exists), creates nothing until you say go, never deletes and never touches rows, and writes each data source id back into `project.md` under `## Notion databases`.
4. **Check.** `./run.sh doctor <slug>` runs `notion.access`, which reads every database through the integration and names each one it cannot reach. All 404 means the integration sees none of the teamspace: share it again, see `../setup/access.md`.

Core modules: Clients, Leads, Tasks, Documents (conversation reports are Documents of Type Report; the separate Reports database is retired, decision 0022). Workflows are not a Notion module: they are files in the project folder (`projects/<slug>/workflows/`, `hub workflows list <slug>`). Optional: Deals, Organizations, Open loops, Participants, Expenses and Payments, Business contacts, Knowledge. A property flagged `vertical` (real estate) or `ads` is built only if the interview asks for it.

## Telegram and WhatsApp on a client

Clients has two fields for messengers, next to `Phone`, both edited by people (P84). The Hub reads them to link the owner's messenger chats to the right client by itself (Messengers ▸ Chats; project setting `messengers.autolink`); nothing else uses them, and the Hub never writes them.

- **Telegram** (text): the person's Telegram username without `@`, for example `anna_k` (an `@anna_k` or a `t.me/anna_k` link is read the same way, in any case), or their phone in +E.164. A Telegram chat links when its username or its phone equals this field or `Phone`.
- **WhatsApp** (phone number): the number in +E.164, country code first, for example `+6281234567890`. Fill it only when it differs from `Phone`. A WhatsApp chat links when its number equals `Phone` or this field.

+E.164 means `+`, the country code, then the number, without the leading 0 of a local number. A number written without its country code (`0812...`) is skipped: the Hub never guesses the country. A chat links only when exactly one client with an Email matches; a number two clients share links nothing and shows as a suggestion instead, and a contact's saved name never counts. Field descriptions, word for word: [`fields.md`](fields.md#clients).

## Rules that matter

- **Names are the interface.** Hub and the CRM sync find fields by their exact name and select options by label. Never rename a property or an option.
- **One writer per field** (the Writer column in `fields.md`). The owner's backend (a form handler) writes a lead; the Hub writes only `Client` on it ([`../core/21-leads.md`](../core/21-leads.md)); a session writes the client history through the connector; people write notes and owners; agents draft and propose, and write only after an OK.
- **The API refuses some things silently:** no `status` property (use select), no cross-database formulas (skipped and named in the report), a missing select option stops Hub writing (the option is added, then read back). The full list is `10-api-traps.md` in the pack.
- **Keep Help true.** A new database, field or workflow is not finished until its Help page and the pack's schema file say so; then run `pnpm hub docs` to refresh `fields.md`.

## Changing the schema

Edit `schema/<db>.json` in the pack (and the matching markdown rule), run `pnpm hub docs`, commit both. The installer test fails when `fields.md` is out of date.

Update this page when the architecture changes.
