# Leads

Source: Help / Modules / Leads and the live Leads database(properties and six views fetched 2026-11-14 via the Notion MCP).

Purpose: intake of website requests and, under the mailbox policy (`Save to Notion` on), enquiries from unknown email senders. Written by Hub. Not a client: when a lead is won the CRM creates the person, the sync brings it into Clients and `Client` is linked.

## Properties (title `Name`)

| Property | Type | Writer / meaning |
|---|---|---|
| Name | title | Hub: sender's name or company |
| Status | select: New, In progress, Won, Lost, Spam | Hub sets New on create, then people. Description: "New, In progress, Won, Lost, Spam. The integration sets New on create." |
| Source | select: Website, Telegram, Referral, Other, Email | Hub: Website for the form, Email for a lead from mail. Option `Email` carries the description "The first message arrived by email, not through the website form." A missing `Email` option stops Hub writing |
| Received at | date | when the request arrived |
| Email | email | sender |
| Phone | phone_number | sender |
| Company | text | form field |
| Message | text | free-text body; never filled for a lead from mail |
| Details | text | every form field without a column, one `Label: value` per line |
| Form | text | form identifier, e.g. contact, pricing |
| Source page | text | path of the page the form was on |
| Page URL | url | page the form was submitted on |
| Locale | text | page language |
| Mailbox | text | connected mailbox that received the mail (a missing Mailbox is tolerated) |
| Client | relation to Clients, limit 1 | Hub sets it when exactly one person matches Email or Phone |
| Owner | person | people |
| Next step | date | when to follow up; people |
| Notes | text | internal comments; people |
| Conversation summary | text | not used on Leads; leave empty (kept for the email assistant contract) |
| Hub run id | text | idempotency key; never edit |
| Ad click | text | raw ad-click field (gclid, msclkid, utm_*, landing, first_visit, ad_consent) |
| GCLID, MSCLKID, LinkedIn click ID, UTM source, UTM medium, UTM campaign | text | parsed from Ad click; mapping by Hub pending |
| Ad click time | date | first visit from the ad |
| Ad consent | checkbox | advertising cookies allowed |
| Brand | multi_select, no options | vertical (to be renamed Site), skip by default. Not present in the reference Leads, so it is not in `schema/leads.json` |

Hub looks Leads up by name: Name, Form, Email, Phone, Message, Page URL, Source, Status, Received at, Mailbox, Hub run id. Do not rename them.

Leads has no Grade, Do not contact or Relationship: treat as Standard, contactable, unknown.

Machine-readable: `schema/leads.json`, `views/leads.json` (read live 2026-11-14; the JSON wins). Diff: Source and Status are `select`; ad-click columns are flagged `ads`.

## Views (first is the default)

Inbox, Needs reply, In progress, Board, All, Won no client. Exact filters in `08-views.md`.

## Rules

- Hub never overwrites Status after create, Owner, Next step, Notes or a Client someone set. It writes only `Leads.Client`; `Clients.Leads` fills itself.
- No rows are created in Clients from Notion.
- Before a client exists the follow-up date is `Next step`; after linking, work goes to Tasks.
- Deals are not linked to leads; the deal is reachable through the client.
- Any form field is kept: fields with a column go there, the rest go to Details (secrets and honeypot fields never). To filter on a form field, add a text column and have an admin map it.

## Access

The integration needs access to Leads and Clients (for matching). Share the whole teamspace with it.
