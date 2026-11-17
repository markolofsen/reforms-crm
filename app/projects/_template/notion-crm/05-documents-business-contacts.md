# Documents (reports included), Business contacts

Source: Help / Modules / Documents and Business contacts (live name Contacts), edited 2026-11-10; the merged Documents database read live from the saas and realty CRMs through the Notion MCP on 2026-11-17 (decision 0022). Machine-readable: `schema/{documents,business-contacts}.json`, `views/{...}.json` (the JSON wins over the tables below). There is no separate Reports database any more: a report is a Document of Type `Report`. Live differences: Documents `Status` is a `select` in the saas CRM and a `status` in realty (created as select here, trap 1); Business contacts `Other socials` is text; Category options in the pack: Partner, Supplier, Service provider, Contractor, Lawyer, Bank, Other (older CRMs may still have Client and the name Contacts). Resolved by the owner on 2026-11-14: Business contacts stays separate from Clients and is a standalone address book; the live description "To be merged into People" is superseded.

## Documents (title `Document`)

Purpose: the register of company documents (references, procedures, specifications, briefs, contracts) and of conversation reports (phone call, video call, meeting with a client, partner or the team). The page may hold the document, a file, or a link to an external source; keep one authoritative version. Notion is the source; no CRM sync, no automatic task creation.

| Property | Type | Meaning |
|---|---|---|
| Document | title | clear name |
| Date | date | date of the document, or when the conversation happened |
| Type | select: Reference, Spec, Procedure, Brief, Contract / legal, SEO, Other, Report | kind of document; `Report` = conversation report (options per company, SEO is the owner's) |
| Status | select (realty: a `status` type; the API-created one is select): Draft, Review, Current, Superseded | document lifecycle; not used for reports' preparation |
| Report status | select: Awaiting files, In progress, Ready for review, Final | report preparation, Type = Report only |
| Format | select: Phone call, Video call, In person, Other | conversation format, reports only; blank where unknown |
| Summary | text | short description |
| Owner | person | responsible for keeping it current |
| Team participants | person | Notion users from the team, reports only (notifications none) |
| Other participants | text | outside people not in Clients; never create a CRM contact for a report |
| Document link | url | external authoritative file |
| Files | files | |
| Last edited | last_edited_time | |
| Clients | relation to Clients, optional, one-way | CRM people the document concerns (named `People` in the live saas CRM, `Clients` in realty: the pack's alias covers both; not synced) |
| Deal | relation to Deals | optional |
| Tasks | relation to Tasks, two-way (reverse `Tasks.Documents`) | actions arising from the document or conversation |
| Original participants, Original report | text, url | migrated reports only; skip in a fresh project |

Template: `Conversation report` (Type = Report; sections Summary, Key points, Decisions, Next steps, Recording or transcript).
Views: All documents (Last edited desc, default), Current (Status = Current), By type, Reports (Type = Report, Date desc). Status and relations are not access controls. `Tasks.Documents` is the only link between tasks and documents or reports: the old `Tasks.Conversation report` and `Source report` are retired.
How to use a report: create a Document from the template; summarise key points and decisions; never invent missing details; create each agreed action as a separate task in Tasks, link it through `Tasks`, set Area and Client or Deal. The relation does not create tasks. Check access before storing recordings or sensitive conversations.
Adding `Tasks.Documents` changes the Tasks schema: tell the integration developer.

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
