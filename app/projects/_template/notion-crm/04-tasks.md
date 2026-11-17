# Tasks

Source: Help / Modules / Tasks and the live Tasks data source of a reference CRM.

Purpose: the one task database of the company: client work, finance, team, admin, tech, marketing. Every module links its work here. A task is one concrete action starting with a verb. The migration notes of Help (149 copied tasks, templates) are history and not part of the structure.

## Properties (title `Task`)

| Property | Type | Options / target | Writer |
|---|---|---|---|
| Task | title | | people |
| Area | select | Clients, Finance, Team, Admin, Tech, Marketing | people, agents, backend. Clients = work for a client or deal; only these go to the CRM |
| Status | select (not the Status type; see `10-api-traps.md`) | Inbox, Not started, In progress, Waiting, In review, Done, Cancelled | people. Inbox = not triaged; Waiting = ball is with someone else (fill Waiting on) |
| Due | date | | people or backend |
| Priority | select | Urgent, High, Normal, Low | people or backend |
| Type | select | Call, Message, Meeting, Viewing, Documents, Offer & contract, Payment, Follow-up, Other | people or backend |
| Assignee | person | | people |
| Waiting on | select | Client, Lawyer, Bank, Developer, Government, Vendor, Other | fill when Waiting |
| Client | relation to Clients | | set from the task |
| Deal | relation to Deals | | set from the task |
| Organization | relation to Organizations | optional: the law firm, bank or developer | |
| Business contacts | relation to Business contacts, two-way | reverse Business contacts.Tasks | |
| Expense | relation to Expenses | reverse Expenses.Tasks | |
| Documents | relation to Documents, two-way | reverse Documents.Tasks | |
| Parent task, Sub-tasks | relation to Tasks (self), paired | | not synced |
| Blocked by, Blocking | relation to Tasks (self), paired | | not synced |
| Work type | select | Compliance, Banking, Legal, Tax, Admin, Web, SEO, Sales support, Hiring | not synced; differs from Type |
| First step | text | the smallest action that starts it | not synced |
| Doc link | url | link to a document, not the document | not synced |
| Delegate to | select, no options | | not synced |
| Times deferred | number | count of mornings deferred | not synced |
| Focus | select | Frog, Q1 today; cleared daily | not synced |
| Done date | date | when closed | backend or by hand |
| Source | select | Manual, CRM, Agent | who created the task |
| CRM id, Synced at | text, date | | backend; do not edit |
| Created, Last edited | created_time, last_edited_time | | system |
| Stage | rollup of Deal.Stage | | never edited |
| Is open, Open due | formula | helpers for rollups on Clients and Deals | cannot be created cross-database (see traps) |
| Overdue, Is done | formula | past due and not closed; true for Done | |

Live extras not needed in a fresh project (migration, skip): Source report and Conversation report (the Reports database is retired, decision 0022: link a report through Documents), Meeting, Original task, Original created, Original last edited, the Project relation and `CRM tasks` on Projects.

## Views

My tasks, Today, Week, Waiting (grouped by Waiting on), Inbox, Board (by Status), By client, By area, By project (skip without Projects), Needs area, Done (Done and Cancelled), All. Live order starts with Board; a new project may start with My tasks. Live JSON: `views/tasks.json`. See `08-views.md`.

## Rules

- One task is one action. Set Area on every new task; client work also needs a Client or Deal when known.
- For Waiting, fill Waiting on. Close with Done or Cancelled; never delete history.
- Documents (reports included) do not create tasks; the relation only links.
- Leads use `Leads.Next step` until linked to a person.
- CRM sync scope: Area = Clients, or Client or Deal set. Other tasks stay in Notion.
- Open tasks (for counts): not Done and not Cancelled. Overdue excludes Done, Cancelled and tasks due today.
