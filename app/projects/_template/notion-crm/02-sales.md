# Sales: Clients, Deals, Organizations, Open loops, Participants

Source: Help / Modules / Sales and Clients, Deals = Opportunities, Participants, Guides: Opportunity model, Dedupe by email, Drive folder, Email tracks (2026-11-09/10); live property lists from the owner's live schema notes (custom layer) (read 2026-11-14). Read via the Notion MCP.

Purpose: everyone we work with or sell to, the deals in progress and what each needs next. Clients (the person database, formerly People; the relation properties that pointed at it are now named `Clients`) is the master person. Rows of Clients, Deals, Organizations and Open loops are created by the CRM sync, never by hand in Notion. Where a project has no sync, the databases still exist.

## Clients (title `Name`)

| Property | Type | Writer | Notes |
|---|---|---|---|
| Name | title | CRM | |
| Email | email | CRM | main address; dedupe key (lower-case, trimmed) |
| Other emails | text | notion | extra addresses, comma-separated; Not synced |
| Phone | phone_number | CRM | |
| Gmail | url | CRM | a Gmail search link, not a log |
| Drive folder | url | notion | link to Google Drive; Not synced; no folder is created |
| Relationship | select: Lead, Prospect, Client, Partner, Other | CRM | |
| Activity | select: Active, Quiet, Dormant, Lapsed | CRM | |
| Grade | select: Priority, Standard, Low | human | Priority: always a human. Standard (and empty): drafts only. Low: automatic reply only if the owner enabled it. Empty is Standard, never Low |
| Type | select | CRM | generic: Lawyer, Banker/Lender, Accountant/Tax, Developer, Service provider, Media, Colleague, Other. Vertical adds Agent/Broker, CBI agent |
| Lead source | select | CRM | generic: Referral, Past client, Event, Outbound, Other. Vertical: the vertical's own source names |
| Islands | multi_select | CRM | vertical |
| Waiting band | select: Today, 1-3 days, Up to 2 weeks, Up to a month, Over a month | CRM | |
| Waiting since, Follow-up on, Last inbound, Last outbound, Last two-way contact, Synced at | date | CRM | |
| Created | created_time | system | |
| CRM id | text | CRM | |
| Needs review, Do not contact | checkbox | CRM | |
| Do not follow up | checkbox | notion | distinct from CRM-owned Do not contact |
| Do not follow up reason | text | notion | |
| Next step | text | read back | |
| Conversation summary | text | Hub | rolling memory, about 1,500 characters; people may correct it |
| Synthetic | checkbox | notion | technical row of the Hub mail-chain check; excluded from counts; never edit or delete |
| Owner note | text | read back | vertical |
| Organization | relation to Organizations | CRM | |
| Deals | relation to Deals | CRM | |
| Open loop items | relation to Open loops | CRM | |
| Leads | relation to Leads | notion | set from Leads.Client |
| Tasks | relation to Tasks | notion | set from Tasks.Client |
| Participations | relation to Participants | notion | set from the Participants row |
| Open loops | rollup (Open loop items, unchecked) | CRM | |
| Open tasks | rollup of Tasks, open only | formula | uses Tasks `Is open` |
| Overdue tasks | rollup | formula | |
| Task due | rollup, earliest date of open tasks | formula | uses Tasks `Open due` |
| No task | formula | formula | contact allowed, Relationship Lead/Prospect/Client, Activity Active/Quiet, no open task |

Client history is one rule: the `Conversation summary` property plus a `Conversation log` heading at the bottom of the Client page, both written by Hub only (one bullet `YYYY-MM-DD · Channel · phrase [e:abc123def456]`, newest 40 kept). Hub adds the heading itself; never create it. Leads keep no history.

## Deals (the opportunity; do not create a second deals database)

Unit of work: one client, one pipeline, one stage, one next step. One client per deal (`Client`, limit 1); everyone else is a Participants row.

| Property | Type | Writer |
|---|---|---|
| Title, Client (relation to Clients, limit 1), Pipeline, Stage, Furthest stage, Stage since, Days in stage, Stuck, At risk, Priority | mixed | CRM |
| Outcome reason, Last touch, Next touch, Needs review, CRM id, Synced at | mixed | CRM |
| Referral (None, Referred in, Referred out), Referral status (Introduced, Registered, Fee due, Fee received, Lost) | select | CRM |
| Others (relation to Clients, no role) | relation | CRM; do not use, use Participants |
| Data room | url | CRM; do not use, use Drive folder |
| Purpose, Product, Island, CBI, Budget band, Timeline, Financing, Unit, Development | mixed | CRM, vertical |
| Next step | text | read back |
| Drive folder | url | notion |
| Hub id | text | reserved for the hub deal id; writer not verified |
| Participants | relation to Participants | notion |
| Tasks | relation to Tasks | notion |
| No task, Open tasks, Task due | formula / rollup | formula (a deal is open when its Stage is not Closed, Lost, Not qualified, Withdrawn, Expired or Inactive) |

Pipeline options (generic names; the live CRM uses these): Buyers, Sellers, Developers, Referral partners. Investment is a Purpose, referral is Referral plus Referral status; neither is a pipeline. Stage is one shared list for every pipeline, 25 options (read live 2026-11-14, same list in `Furthest stage`): New lead, Seller lead, Prospecting, Qualified, Warm, Hot, Offer, Off-market, Exclusive, Contract, Firm / Pending, Closed, On hold, Lost, Not qualified, Withdrawn, Expired, Potential, In discussion, Information received, Agreement signed, Data room live, Active inventory, Active, Inactive. Closed-type stages (excluded from open views): Closed, Lost, Not qualified, Withdrawn, Expired, Inactive. A generic project may start with a short list but must keep those six names, the views filter on them. Full property list: `schema/deals.json`.

Ad-tracking columns also exist live and were not in Help: Lead quality (Unqualified, Qualified, Hot), Ad click time, Qualified at, Closed at, GCLID, MSCLKID, UTM campaign (filled by the website-to-CRM ads integration). Deploy them only when the project runs ads (flag `ads` in the schema file).

## Organizations

Name (title), Kind (select: Brokerage, Developer, Law firm, Bank, CBI agency, Resort, Media, Other), Domain (text), Clients (relation to Clients, reverse Clients.Organization), CRM id (text), Synced at (date): all CRM (read live 2026-11-14, `schema/organizations.json`). One view, All. Nothing is edited by people. One row is a developer, law firm, bank or agency.

## Open loops

A promise from an email or call, still open (`schema/open-loops.json`, read live 2026-11-14). Promise (title), Who owes (select: owner's name, Client, Other), Due (date), Person (relation to Clients, reverse Clients.Open loop items), Deal (relation to Deals), CRM id (text): CRM. Done (checkbox): read back. Overdue: formula on the same database (Due passed, Done unchecked), described as CRM. Views: Owner owes, Waiting on others, Overdue.

## Participants (Notion-only by design)

One row is one person on one deal, with a role. Title `Participant` (label such as `Lawyer, Smith`).

| Property | Type | Notes |
|---|---|---|
| Participant | title | `Role, Name` |
| Opportunity | relation to Deals | one deal per row; the reverse is Deals.Participants |
| Person | relation to Clients | one person per row; the reverse is Clients.Participations |
| Role | select: Lawyer, Agent/Broker, Co-buyer, Referrer, Developer contact, Banker/Lender, Accountant/Tax, Other | to add a role, add an option |
| Primary | checkbox | the main contact for that role on that deal |
| Notes | text | |
| Opportunity key | text | stable key of the Django opportunity, for a deal row not yet synced; added to the pack 2026-11-14 |

Role is what the person is on this deal; `Clients.Type` is what the person is in general. A participant is not a client and gets nothing automatically. Notion does not enforce one deal and one person per row: check on save. Set links from the Participants row, not from the reverse fields.

## Today block (on the Sales page)

Four linked views, not copies: To do (Tasks, client work only: Area = Clients or Client or Deal set; tabs Today, Week, Waiting), Follow-ups (Clients; Today, Waiting, No task), Pipeline (Deals; No task, Hot, At risk), owner-owes (Open loops; Open promises). See `08-views.md`.

## Dedupe and Drive folder rules

- Two records are the same person when they share an email (lower-case, trimmed; no plus-tag or dot rules). The rule lives in Django, not in Notion; a clash is a proposal for a human, nothing merges by itself. Search `Email` and `Other emails` before adding a person.
- Drive folder: a link only, no creation, no access granted; one file at a time goes in Documents.
