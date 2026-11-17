# Reports, Documents, Business contacts

Source: Help / Modules / Reports, Documents, Business contacts (live name Contacts), all edited 2026-11-10; Reports property list from the owner's live schema notes (custom layer) (read 2026-11-14). Read via the Notion MCP. Machine-readable: `schema/{reports,documents,business-contacts}.json`, `views/{...}.json` (read live 2026-11-14; the JSON wins over the tables below). Live differences: Reports and Documents `Status` are type `status` (created as select, trap 1); Business contacts `Other socials` is text; Category options in the pack: Partner, Supplier, Service provider, Contractor, Lawyer, Bank, Other (older CRMs may still have Client and the name Contacts). Resolved by the owner on 2026-11-14: Business contacts stays separate from Clients and is a standalone address book; the live description "To be merged into People" is superseded. Migration paragraphs of those pages (copied reports, documents, counts) are history and are left out.

## Reports (title `Report`)

Purpose: one report per conversation (phone call, video call, meeting with a client, partner or the team), plus migrated work reports. Notion is the source; no CRM sync, no automatic task creation.

| Property | Type | Meaning |
|---|---|---|
| Report | title | short topic |
| Date | date | when it happened |
| Format | select: Phone call, Video call, In person, Other | blank where unknown |
| Status | select (older CRMs use a `status` type, which the API cannot create): Awaiting files, In progress, Ready for review, Final | report preparation |
| Summary | text | short overview |
| Clients | relation to Clients | known participants (renamed from `People` by owner decision 2026-11-14; older CRMs may still use `People`); not synced |
| Other participants | text | outside people not in Clients; never create a CRM contact for a report |
| Team participants | person | Notion users from the team |
| Deal | relation to Deals | optional (single value) |
| Tasks | relation to Tasks, two-way (reverse `Tasks.Conversation report`) | actions arising from the conversation |
| Original participants, Original report | text, url | migration only; skip in a fresh project |

Template: `Conversation report` (date, format, participants, summary, decisions, recording or transcript). Views: All reports (newest first, default), By person (group by Clients), By team participant (group by Team participants).
How to use: create a report from the template; summarise key points and decisions; never invent missing details; create each agreed action as a separate task in Tasks, link it, set Area and Client or Deal. The relation does not create tasks. Check access before storing recordings or sensitive conversations.

## Documents (title `Document`)

Purpose: the register of company documents (references, procedures, specifications, briefs, contracts). The page may hold the document, a file, or a link to an external source; keep one authoritative version.

| Property | Type |
|---|---|
| Document | title |
| Type | select (kind of document; options per company) |
| Status | select: Draft, Review, Current, Superseded |
| Summary | text |
| Owner | person (responsible for keeping it current) |
| Document link | url (external authoritative file) |
| Files | files |
| Last edited | last_edited_time |
| Clients | relation to Clients (optional) |
| Deal | relation to Deals (optional) |
| Tasks | relation to Tasks, two-way (reverse `Tasks.Documents`) |

Views: All documents (newest edits first), Current, By type. Status and relations are not access controls. Adding `Tasks.Documents` changes the Tasks schema: tell the integration developer.

## Business contacts (title `Name`)

Purpose: a standalone address book of general business contacts: contractors, lawyers, banks, vendors, partners, service providers. A business contact is never a client; clients live in Clients. Separate from Clients and Organizations; no sync, no dedupe, no merge into Clients (owner decision 2026-11-14). Optional module: deploy only on request.

| Property | Type |
|---|---|
| Name | title |
| Record type | select: Person, Company |
| Category | multi_select (Partner, Supplier, Service provider, Contractor, Lawyer, Bank, Other; options per company) |
| Company, Role | text |
| Email, Email 2 | email |
| Phone | phone_number |
| Telegram, WhatsApp | text |
| Website, LinkedIn, Other socials | url |
| Location | text |
| Context | text |
| Tasks | relation to Tasks, two-way (reverse `Tasks.Business contacts`) |
| Related clients | relation to Clients, optional and one-way (no reverse on Clients); link only when a contact is tied to specific clients, for example their lawyer |
| Related organizations | not in the pack; the link to Organizations is optional too, add it only on request |

Views: All contacts (by name), By category (a contact may appear in several groups).
