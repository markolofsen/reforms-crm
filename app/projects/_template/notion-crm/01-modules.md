# Modules, dependencies, creation order

Source: Help / CRM overview and Modules, Help / Modules pages, the owner's live schema notes (custom layer). Read 2026-11-14 via the Notion MCP; Reports merged into Documents on 2026-11-17 (decision 0022).

## Module map

| Module | Databases | Core | Source of truth | Help page |
|---|---|---|---|---|
| Sales | Clients (formerly People; Clients = the people we sell to), Deals, Organizations, Open loops, Participants | Clients: yes. Deals, Organizations, Open loops: with the CRM sync. Participants: optional | CRM sync (Notion-only fields marked) | Sales and Clients, Participants |
| Leads (under Sales) | Leads | yes | Hub: website form and unknown email senders | Leads |
| Tasks | Tasks | yes | Notion (client work is synced to the CRM) | Tasks |
| Knowledge | Knowledge | **no (not deployed by default)** | Notion, synced to the CRM | Knowledge |
| Documents | Documents (conversation reports are Documents of Type Report) | yes (documents and conversation log) | Notion or an external file | Documents |
| Expenses | Expenses, Payments | optional | Notion (bank integration planned) | Expenses |
| Business contacts | Business contacts | optional, standalone address book of contractors, lawyers, banks, vendors; never clients | Notion | Business contacts |

A project is a chosen list of modules. The core databases are `clients`, `leads`, `tasks`, `documents` (reports are documents); `deals`, `organizations`, `open-loops`, `participants`, `business-contacts`, `expenses`, `payments` are optional slugs; `knowledge` is not deployed (the knowledge base is the local `knowledge/` folder). Which ones a project must list in `projects/<slug>/project.md` is its kind's `required` (`@docs/core/16-projects-and-knowledge.md` section 3A).

## Dependencies (a relation target must exist first)

```
Organizations ─┐
Clients ───────┤
Deals ─────────┤──> Participants (Opportunity -> Deals, Person -> Clients)
Open loops  (Person -> Clients, Deal -> Deals)
Leads    (Client -> Clients)
Tasks    (Client, Deal, Organization, Expense, Documents, Business contacts, itself)
Documents(Clients -> Clients, Deal -> Deals, Tasks -> Tasks; reports are Documents of Type Report, decision 0022)
Business contacts (Tasks -> Tasks; Related clients -> Clients, optional)
Payments (Expense -> Expenses);  Expenses (Tasks from Tasks.Expense)
Knowledge: no relations
```

## Creation order

Create databases without relations first, add relations in a second pass once both ends exist (a relation needs the target data source id; two-way relations create the reverse property on the other side).

1. No-relation databases: Knowledge, Business contacts, Expenses, Organizations, Clients, Deals, Documents.
2. Databases whose relations point to step 1: Open loops, Leads, Participants, Payments.
3. Tasks (the hub: relations to Clients, Deals, Organizations, Expenses, Documents, Business contacts, itself).
4. Second pass, relations that close the loop: Documents.Tasks, Business contacts.Tasks (two-way, created by Tasks' relation properties), rollups and formulas that need Tasks (Clients: `Open tasks`, `Overdue tasks`, `Task due`, `No task`; Deals the same).
5. Views, then page templates, then the Help pages (see `09-help-pack.md`).

Where the Sales module has no CRM sync, Clients, Deals, Organizations and Open loops still exist as databases (Tasks, Leads and Documents link to them); they stay empty until rows are added by hand or the sync is set up. Ask in the interview; default for a project without a sync is Clients, Tasks, Leads, Documents (Knowledge only when the owner asks for it).

## Where things live (page layout)

- A teamspace page per project for the Sales databases (`Sales` in the pack; **`Customers`** in the live CRMs since 2026-11: Clients, Organizations, Deals, Participants) and a four-list `Today` block (linked views: To do, Follow-ups, Pipeline, owner owes).
- Leads is a database at the top level of the teamspace (moved there on 2026-11-10); Tasks, Documents, Expenses, Business contacts (**`Contacts`** in the live CRMs) at the top level too. Knowledge stays at the top level only where the owner wants it; in the live SaaS CRM it sits in `Archive` (the knowledge base is the local `knowledge/` folder).
- An `Archive` page at the root of the teamspace holds what is retired: the Help pages, old Workflows (decision 0017), Knowledge. Nothing is deleted.
- A `📘 Help` page: `CRM overview`, `Modules`, `Guides`, `Changes` list (see `09-help-pack.md`).
