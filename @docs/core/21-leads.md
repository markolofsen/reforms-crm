# Leads in the core

Layer: core. Decision: `crm/@dev/decisions/0019-leads-and-the-notion-pack-follow-the-live-crm.md`. Field list: `app/projects/_template/notion-crm/schema/leads.json`, module page `03-leads.md`.

A **lead** is a request that is not yet a client: a website form, a message from an unknown email sender, a referral. Every project that sells has a `Leads` database, at the top level of its teamspace. The core does not care what writes it, only that the writer follows this contract; people handle the rows; the agent reads them and drafts.

## Who writes what

| Writer | Writes | Never writes |
|---|---|---|
| The owner's backend (a site's form handler, e.g. django_notion), mail agent for an unknown sender | Name, Status = New (on create only), Source, Received at, Email, Phone, Company, Message, Details, Form, Source page, Page URL, Locale, Brand, Mailbox, Hub run id, ad-click columns | Status after create, Owner, Next step, Notes, Client |
| The Hub (core) | `Client` (only when exactly one person matches Email or Phone) | everything else |
| People | Status, Owner, Next step, Notes, Client | Hub run id |

- **Idempotency.** `Hub run id` is the writer's key for one submission. A writer looks the row up by it before creating, so a retry never makes a second lead.
- **Brand** names the site or product. Its options are the project's own; a writer uses exactly those names. A lead for two products carries two.
- **A missing option stops the writer**, not the form: if `Source` lacks `Email` or `Brand` lacks the site, the writer must report it, never invent an option.
- **Spam** is a Status, not a deletion.
- A form field with no column of its own goes to `Details`, one `Label: value` line each. Secrets and honeypot fields never.

## What the core does with leads

1. **Reads them** (read only): `notion-dump leads <project>` (token) prints the counts by Status, Brand and Source and three lists that mirror the live views: *needs reply* (New or no status, received before today), *overdue* (In progress, Next step before today), *won without a client*. A session without a token reads the same rows through the Notion connector and applies the same three rules.
2. **Drafts for them**: `triage-mail` step 3b picks the workflow `new-website-lead` (project's own `workflows/`) for a lead that waits. Draft only, never a send.
3. **Counts them** on the admin overview (`clients` and `leads` sources).

The core never creates a client from a lead and never changes a lead's Status.

## Access

Which integration needs access to Leads and Clients (the backend that writes, the hub that reads) and how to share it: [`../setup/access.md`](../setup/access.md). `hub doctor` fails `notion.access` on `leads` when the hub's integration cannot see it.

Update this page when the architecture changes.
