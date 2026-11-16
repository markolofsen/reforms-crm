# Knowledge and Workflows

Source: Help / Modules / Knowledge, Workflows, Guides / Agent automation; property lists and options from the owner's live schema notes (custom layer) (read 2026-11-14). Read via the Notion MCP.

## Knowledge (title `Question`)

Machine-readable: `schema/knowledge.json`, `views/knowledge.json` (read live 2026-11-14; the JSON wins). Live Category, Programmes, Islands and Folder options are the owner's real-estate set (flagged `vertical`; the generic Category list is kept as `genericOptions`). Views: All, Needs approval, `<Owner> to confirm`, Sync problems, Playbooks, as JSON.


Purpose: approved answers to the questions clients and partners ask. One page per question: the title is the question, the page starts with the answer; never a second page for the same question. When a value changes, update the answer and move the old one under `## Earlier values` with dates. Email drafts use only approved entries. Synced with the CRM.

| Property | Type | Meaning |
|---|---|---|
| Question | title | |
| Approved | checkbox | ticked = eligible; publishes to the next draft. New pages reach the CRM unapproved |
| Use | select: STATE, MARKER | STATE: a draft may state it. MARKER: context only |
| Audiences | multi_select: CLIENT, LEAD, MIGRATION_ADVISOR, REFERRAL_PARTNER, LAWYER, DEVELOPER, SELLER, BANK, REALTOR, PEER_BROKER, VENDOR, GOVERNMENT, ANY | empty = visible to no chat. `ABOUT_OWNER` is not an audience |
| Category | select, stored in capitals | generic: PLAYBOOK, TERMS, SUPPORT, SOURCES, PRODUCT, PRICING, DATA, BILLING, API, ABOUT; vertical: PROGRAMMES, APPLICATION, BUYING, SELLING, FINANCING, OWNING, DEVELOPMENTS, ISLANDS, TRAVEL, TAX, OUTLOOK, ABOUT_OWNER |
| Kind | select: RULE, FIGURE, PROCESS, PRACTICE, POSITION, PRODUCT, PLACE, BIO, PLAYBOOK | |
| Stages | multi_select | generic: ENQUIRY, DISCOVERY, CHOOSING, RESERVING, CONDITIONAL, APPLICATION, BUILDING, CLOSING, OWNING, SELLING |
| Programmes, Islands | multi_select | vertical; no options in a generic project |
| Folder | select | topic/subtopic, Notion only; options per project |
| Phrasings | text | how clients ask it, `|`-separated; searched, never quoted |
| Source, Supersedes | text | provenance |
| Valid from, Valid until, Last confirmed | date | past Valid until the entry goes to the owner to confirm |
| Sync state | select: clean, conflict, rejected | written by the CRM sync |
| Sync hash, Sync note, CRM id, CRM updated at | text | written by the sync; do not edit |

Views: All (grouped by Category, default), Needs approval (not approved), `<Owner> to confirm` (markers and expired), Sync problems (conflict or rejected), Playbooks (grouped by audience).

Rules: chat uses only Approved entries; an email draft may use an entry only when Approved, Use = STATE, Audiences contains the sender's audience or ANY, Category is not the owner's personal category (`ABOUT_OWNER`; never used by chat), and today is inside Valid from / Valid until. If CRM and Notion both changed an entry, Sync state becomes conflict; resolve by hand. Create the database empty: the company writes its own Knowledge.

## Workflows (title `Workflow`)

Purpose: a page with written steps for one situation ("a new website lead arrived"). The database is a Notion skills database: every page in it is a skill that Notion Agent and Custom Agents follow. Also holds company-wide procedures. Identical in every project.

| Property | Type | Meaning |
|---|---|---|
| Workflow | title | |
| Status | select: Draft, Active, Retired | Draft is never picked by agents |
| Run mode | select: Manual, Agent may pick, Automatic | |
| Applies to | multi_select: Lead, Client, Deal, Partner, Task | |
| Description | text | when to use it; names the situation, not the steps; starts with "Use when..." |
| Owner | person | |
| Last reviewed | date | |
| Files | files | |
| Created by | created_by | |

Template `New workflow`: sections Goal, Input, Steps, Do not, Done when, Report back. Rules every workflow follows: tasks only in Tasks with Area; draft messages, never send; never edit fields marked "Filled by CRM"; never create rows in Clients, Deals or Organizations; propose first, write after OK; end with a short report. A workflow becomes Active only after it ran by hand on 2-3 real records. Agents choose only Status = Active and Run mode = Agent may pick.

Starter workflows (all start as Draft, none tested): New website lead, Lead won: hand off to client work, Client with no next step, Triage an incoming email, Draft a reply to a client email, Follow up a quiet client, Escalate to a human, Schedule a call, New contact by email, Request for a quote or proposal, Automatic acknowledgement, Record a payment, Monthly expense review. Their text is the company's to write; the deploy skill creates none of them unless the interview asks.

## Agent automation (guide)

Three levels: a person names the workflow in Notion AI chat; the agent picks by Description; a Custom Agent runs it on a trigger (needs Business or Enterprise, spends credits). Move a workflow up a level only after it works reliably at the one below. Guardrails: start in suggest-only mode, never let an agent send to clients or edit CRM/Hub-owned fields, leave a trace on every record, review the Activity tab weekly for the first month.
