# Principles and conventions

Source: Help / CRM overview, Help / Guides / Module conventions, Guides / Adapting the CRM to another company. Read 2026-11-14 via the Notion MCP.

## Principles of the CRM

- One owner per field. Every field description says who writes it. Nobody else does.
- One task database. Every module links to Tasks instead of keeping its own to-do fields; `Area` says which part of the company a task belongs to.
- Next step for everyone active: every open deal and active client has an open task. The `No task` views show the gaps.
- Lists, not databases: daily work happens in filtered views (Today, Inbox, My tasks); full databases are for lookup.
- Add only what a view or workflow needs. A new field or view must answer a question someone asks.
- Agents follow written workflows, draft and propose; people approve anything that goes to a client.
- Docs stay true: a change to a module is not finished until its Help page is updated and a line is added to `Changes` on Help.

## What a module is

One or more databases with one purpose and one source of truth; a home page (or a section) with the working lists; a Help page under `Modules` in the same shape as the others (what it is for, what it is made of, fields, views, rules, integrations); links to Tasks for any work it creates.

Checklist for a new module: purpose in one sentence and the daily user; source of truth (Notion, the CRM or an integration); fields with owners written down before building; relations to Tasks and others only where used; two or three working views; the integration contract if a system writes to it; the Help page and the `Changes` line; one or two workflows if agents work with it.

## Field conventions

- Every property has a description that starts with who writes it, in one of these four forms:
  - `Filled by CRM, do not edit`
  - `Written by the integration` (or by name: `Written by Hub`)
  - `Edited by people` (or `Edited by <name>`)
  - `Calculated in Notion. Not synced.`
  Notion-only fields also say `Not synced`.
- Names: English, short, sentence case, no emojis; name the thing, not the type (`Due`, not `Due date field`).
- Selects have no default in Notion: whoever creates the row sets the starting value.
- Formulas exist to drive views and are never synced.
- Money: a number property plus a `Currency` select. Never add amounts in different currencies.

## Relation conventions

- Set a relation from the side where a row belongs to one thing (Task to Client, Lead to Client) and limit that side to 1. The other side fills itself and stays unlimited.
- Do not link everything to everything: add a relation only when a view, a calculation or a workflow uses it.
- If a thing is reachable through one link (a lead's deal through its client), do not add a second.

## View conventions

- Name a view by the question it answers: `Today`, `Needs reply`, `No task`, `Won, no client`.
- The first view is the working list, not `All`.
- Show the few columns needed to act; hide the rest.

## Ownership vocabulary (used in the module files)

| Tag | Meaning |
|---|---|
| CRM | filled by the Django CRM sync; do not edit; may be overwritten |
| read back | a person edits it and the sync reads it |
| Hub | written by the Hub integration (leads, summaries); Hub run id is its idempotency key |
| notion | never synced; people, agents or formulas |
| formula | calculated in Notion; cannot be written |

## Core and vertical

Core (generic, always deploy): the databases and how they link. Vertical (an example vertical: real estate, deploy only on request): Clients `Islands`, `Lead source` and `Type` options such as `CBI agent`; Deals `Island`, `CBI`, `Budget band`, `Product`, `Purpose`, `Timeline`, `Financing`, `Unit`, `Development` and the Pipeline and Stage names; Knowledge `Programmes`, `Islands`, `Audiences` values and the 34 `Folder` options.

How to adapt a project (from Help):

1. Keep every core field. Leave vertical fields empty or hidden in views. Never delete a field the sync still writes.
2. Option lists are data: Pipeline, Stage, Type, Lead source, Role. Start with the generic lists in these files and add the company's own, additively.
3. Hub reads Notion columns through a per-project mapping; some names are fixed in code. Do not rename a column without the developer.
4. A new field names its writer in its description.
5. Write the company's own Knowledge and Workflows. Never reuse another company's answers.

## Rules agents follow on the CRM

- Create tasks only in Tasks, with `Area` set (and Client or Deal for client work).
- Draft messages; never send without a person's OK.
- Never edit fields marked `Filled by CRM`.
- Never create rows in Clients, Deals or Organizations: they come from the CRM.
- Propose changes first, write after confirmation, unless the workflow says otherwise.
- End with a short report of what changed.
- Integrations write idempotently: every row they create carries its own key (`CRM id`, `Hub run id`, `External id`).
