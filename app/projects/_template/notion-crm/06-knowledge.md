# Knowledge

Source: Help / Modules / Knowledge, Guides / Agent automation; property lists and options from the owner's live schema notes (custom layer) (read 2026-11-14). Read via the Notion MCP.

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

## Agent automation (guide)

Three levels: a person names the workflow in chat; the agent picks by its description (workflows are files in the project folder, `hub workflows list <project>`); a Custom Agent runs it on a trigger (needs Business or Enterprise, spends credits). Move a workflow up a level only after it works reliably at the one below. Guardrails: start in suggest-only mode, never let an agent send to clients or edit CRM/Hub-owned fields, leave a trace on every record, review the Activity tab weekly for the first month.
