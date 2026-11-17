# Help pack: the Help section to recreate

Source: Help and its children, read 2026-11-14 via the Notion MCP. There is a second copy under `Hub / Help`; the first is the reference.

## Page tree

```
📘 Help                        intro + Start here + Changes + Sections
  🧭 CRM overview              what it is for, module table, how modules connect (mermaid), request to client flow, principles
  🧩 Modules                   Sales | Company-wide | reference pages
    🏝️ Sales and Clients       what it is made of, Today block, who writes each field, client history, relations
    🤝 Participants
    📥 Leads
    ☑️ Tasks
    📄 Documents          documents and conversation reports (Type = Report)
    🎲 Knowledge
    💳 Expenses
    📇 Business contacts
  🛠️ Guides
    🔌 Integrations            what talks to Notion, rules every integration follows, access, schema-change rules
    🗂️ Module conventions
    🤖 Agent automation
    🧱 Opportunity model
    🔎 Dedupe by email
    📁 Drive folder
    ✉️ Email tracks
    🌍 Adapting the CRM to another company
  CRM Architecture v1 (proposed)   skip: a proposal of the live CRM
  Deals (Opportunity) change log   skip: history of one project
  Deals = Opportunities
```

Emoji icons as shown. Page titles carry no emoji in the property; the icon is the page icon.

## Shape of a module page

`What it is for` / `What it is made of` (databases and what one row is) / `Fields` (table: field, meaning, writer) / `Views` / `How to use` or `Rules` / `Integrations` or `Boundaries and access`. Each page states what is verified and what is not.

## What to copy, what to rewrite, what to drop

| Take | How |
|---|---|
| Help intro, Start here, CRM overview principles, Module conventions, Agent automation guardrails, Dedupe by email, Drive folder, Email tracks, Integrations rules | copy the generic text, replace names with placeholders below |
| each module page's Fields, Views and Rules | regenerate from the knowledge files `02` to `07` for the modules actually deployed, so Help matches the databases |
| Adapting the CRM to another company | copy; it is the instruction for the next adaptation |
| `Changes` list | start clean with one line: `<date>: Help and modules created by the deploy skill (modules: ...)` |
| The previous owner's configuration, counts, migration notes, owner names, domains, test mailboxes, status claims such as "owner reports access configured" | drop; write nothing the new project has not verified |

## Placeholders

`{{company}}` company name; `{{teamspace}}` CRM teamspace name; `{{owner}}` the person who owns the CRM (replaces the previous owner's name); `{{mailbox}}` the connected mailbox; `{{site}}` the website whose form feeds Leads; `{{date}}` deploy date; `{{modules}}` the deployed module list; `{{deploy_id}}` the deploy run id. A page that still contains `{{` after the deploy is a failure of the check.

## Rules

- Every page is created under the project's `📘 Help` page; module pages under `Modules`, guides under `Guides`.
- Link database mentions with the live database url after the databases exist.
- Never copy a claim of verification: new pages say `Not verified yet` where an integration is involved.
- Help is the guide for the team and agents: write it in the company's working language of the Help (default English); files in the repo stay English.
