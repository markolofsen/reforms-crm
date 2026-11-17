# Notion CRM knowledge pack

Source: the `📘 Help` section of the CRM teamspace, the live Leads and Tasks databases, and the owner's live schema notes (custom layer). Read through the Notion MCP, read-only, 2026-11-14.
Used by: `skills/notion-project-deploy/SKILL.md`. Not a project's own knowledge (`knowledge/files/`); it describes the CRM shape to build.

## What this is

A distilled, local description of the CRM in Notion: what each module is for, its databases, property names and types, select options, relations, views and ownership. An agent deploying a project into Notion reads this instead of re-reading Help. Each file carries a `Source:` line with the Notion pages and the date they were read; Notion wins when it disagrees. Where a `schema/*.json` or `views/*.json` exists (now every database) it wins over the tables in the markdown. The JSON carries no data source ids; a deploy creates new ones.

`app/projects/_template/` is a template, not a project: any tool that lists `app/projects/*` must skip folders that start with `_` (same rule as `_archive/`).

## Files

| File | Holds |
|---|---|
| `00-principles.md` | principles, conventions for fields, relations, views, the ownership vocabulary, core vs vertical |
| `01-modules.md` | module map, dependencies, creation order, which are core |
| `02-sales.md` | Clients, Deals, Organizations, Open loops, Participants |
| `03-leads.md` | Leads |
| `04-tasks.md` | Tasks |
| `05-documents-business-contacts.md` | Documents (conversation reports included), Business contacts |
| `06-knowledge.md` | Knowledge |
| `07-expenses.md` | Expenses, Payments |
| `08-views.md` | how a view is written, the views per database |
| `09-help-pack.md` | the Help page tree to recreate, with placeholders |
| `10-api-traps.md` | what the Notion API and MCP refuse or do silently |
| `schema/<db>.json` | machine-readable properties, types, options, relation targets and reverse names, writer, vertical/ads/sync/migration flags, for all 12 databases: clients, leads, deals, organizations, open-loops, participants, tasks, knowledge, documents, business-contacts, expenses, payments (read live 2026-11-14; `documents` 2026-11-17, with the retired Reports merged in, decision 0022). The JSON wins over the tables in `02` to `07`; the tables carry the meaning and rules |
| `views/<db>.json` | the live views as JSON for the same 12 databases (filters, sorts, groups; Tasks, Clients and the Sales databases have `displayProperties` cut to acting columns, the rest list the live columns). `dataSourceUrl` is a placeholder |

## Decision (owner, 2026-11-14)

Contacts stays separate from Clients. Clients = the people we sell to (formerly People). The Contacts database is renamed **Business contacts**: a standalone address book of contractors, lawyers, banks, vendors and partners, never a client, no merge into Clients. A link to Clients (`Related clients`) or Organizations is optional. The leftover relation properties named `People` (Documents, Organizations; reverse on Clients.Organization) are named `Clients` in this pack. Older CRMs may still use the old names.

## Rules for using it

1. A snapshot, not a contract: counts, record numbers and the previous owner's option lists in Help are history. Take structure and rules, not numbers.
2. Every property name is as Notion shows it (sentence case, English). Hub and the CRM sync look fields up by name; do not rename.
3. A property marked **vertical** is an example vertical configuration (real estate). Deploy it only when the project's interview asks for it.
4. A property marked **sync** is written by the Django CRM sync or Hub. A fresh project without those integrations still gets the column (the integration needs it later), with the description "Filled by CRM, do not edit".
5. Refresh this pack when the live Help changes (the `Changes` list on Help is the trigger): re-read the page, edit the file, update its `Source:` date.
