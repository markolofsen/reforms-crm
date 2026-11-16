# Modules, dependencies, creation order

Source: Help / CRM overview and Modules, Help / Modules pages, the owner's live schema notes (custom layer). Read 2026-11-14 via the Notion MCP.

## Module map

| Module | Databases | Core | Source of truth | Help page |
|---|---|---|---|---|
| Sales | Clients (formerly People; Clients = the people we sell to), Deals, Organizations, Open loops, Participants | Clients: yes. Deals, Organizations, Open loops: with the CRM sync. Participants: optional | CRM sync (Notion-only fields marked) | Sales and Clients, Participants |
| Leads (under Sales) | Leads | yes | Hub: website form and unknown email senders | Leads |
| Tasks | Tasks | yes | Notion (client work is synced to the CRM) | Tasks |
| Reports | Reports | yes (conversation log) | Notion | Reports |
| Knowledge | Knowledge | **no (not deployed by default; legacy)** | Notion, synced to the CRM | Knowledge |
| Workflows (under Sales) | Workflows | yes | Notion; a Notion skills database | Workflows |
| Documents | Documents | optional | Notion or an external file | Documents |
| Expenses | Expenses, Payments | optional | Notion (bank integration planned) | Expenses |
| Business contacts | Business contacts | optional, standalone address book of contractors, lawyers, banks, vendors; never clients | Notion | Business contacts |

A project is a chosen list of modules. The five databases in `app/projects/<slug>/project.md` (`clients, leads, workflows, reports`; `knowledge` is legacy, the knowledge base is the local `knowledge/` folder, owner decision 2026-11-15) are the minimum the workflow agent needs; `tasks`, `deals`, `organizations`, `open-loops`, `participants` are optional slugs.

## Dependencies (a relation target must exist first)

```
Organizations ─┐
Clients ───────┤
Deals ─────────┤──> Participants (Opportunity -> Deals, Person -> Clients)
Open loops  (Person -> Clients, Deal -> Deals)
Leads    (Client -> Clients)
Tasks    (Client, Deal, Organization, Expense, Documents, Business contacts, Conversation report, itself)
Reports  (Clients -> Clients, Deal -> Deals, Tasks -> Tasks)
Documents(Clients -> Clients, Deal -> Deals, Tasks -> Tasks)
Business contacts (Tasks -> Tasks; Related clients -> Clients, optional)
Payments (Expense -> Expenses);  Expenses (Tasks from Tasks.Expense)
Knowledge, Workflows: no relations
```

## Creation order

Create databases without relations first, add relations in a second pass once both ends exist (a relation needs the target data source id; two-way relations create the reverse property on the other side).

1. No-relation databases: Knowledge, Workflows, Business contacts, Expenses, Organizations, Clients, Deals, Documents.
2. Databases whose relations point to step 1: Open loops, Leads, Participants, Payments, Reports (without Tasks).
3. Tasks (the hub: relations to Clients, Deals, Organizations, Expenses, Documents, Business contacts, Reports, itself).
4. Second pass, relations that close the loop: Reports.Tasks, Documents.Tasks, Business contacts.Tasks (two-way, created by Tasks' relation properties), rollups and formulas that need Tasks (Clients: `Open tasks`, `Overdue tasks`, `Task due`, `No task`; Deals the same).
5. Views, then page templates, then the Help pages (see `09-help-pack.md`).

Where the Sales module has no CRM sync, Clients, Deals, Organizations and Open loops still exist as databases (Tasks, Leads and Reports link to them); they stay empty until rows are added by hand or the sync is set up. Ask in the interview; default for a project without a sync is Clients and Tasks, Leads, Reports, Workflows (Knowledge only when the owner asks for it).

## Where things live (page layout)

- A teamspace page per project (`Sales`, called `Sales Pipeline` in the live CRM) holding the Sales databases and a four-list `Today` block (linked views: To do, Follow-ups, Pipeline, owner owes).
- Leads and Workflows are databases at the top level of the teamspace (moved there on 2026-11-10; the module Help page stays under Modules); Tasks, Reports, Documents, Knowledge, Expenses, Payments, Business contacts at the top level too.
- A `📘 Help` page: `CRM overview`, `Modules`, `Guides`, `Changes` list (see `09-help-pack.md`).
