# Leads in the core

Layer: core. Decisions: `crm/@dev/decisions/0019-leads-and-the-notion-pack-follow-the-live-crm.md`, and `0044-a-lead-becomes-a-client-at-the-first-reply-sent.md` (P97), which amends its point 1. Field list: `app/projects/_template/notion-crm/schema/leads.json`, module page `03-leads.md`.

A **lead** is a request that is not yet a client: a website form, a message from an unknown email sender, a referral. Every project that sells has a `Leads` database, at the top level of its teamspace. The core does not care what writes it, only that the writer follows this contract; people handle the rows; the agent reads them and drafts.

## Who writes what

| Writer | Writes | Never writes |
|---|---|---|
| The owner's backend (a site's form handler, e.g. django_notion), mail agent for an unknown sender | Name, Status = New (on create only), Source, Received at, Email, Phone, Company, Message, Details, Form, Source page, Page URL, Locale, Brand, Mailbox, Hub run id, ad-click columns | Status after create, Owner, Next step, Notes, Client |
| The Hub (core, P97) | `Status` In progress at the first confirmed send of a reply to the lead, Spam on the owner's click and New on its Undo; `Client` at that send (the one Clients card with the lead's address, or the card it creates); one new Clients page per person who had none (Name, Email, Phone, Relationship Lead, Brand) | every intake field, Owner, Next step, Notes; never a delete; never an existing Clients card |
| The agent (a session, P138) | `Conversation summary`: one line, its read of the lead (who, where, size, the next step), written once after the first draft when empty; the lead card shows it on top | every other field; never overwrites a summary |
| People | Status, Owner, Next step, Notes, Client, Conversation summary | Hub run id |

- **Idempotency.** `Hub run id` is the writer's key for one submission. A writer looks the row up by it before creating, so a retry never makes a second lead.
- **Brand** names the site or product. Its options are the names of the project's `## Brands` rows (doc 16 section 3C), exactly, and a project's options never name another project's brands; a writer uses exactly those names (the agent takes the brand of a mail from `message_show`). A lead for two products carries two.
- **A missing option stops the writer**, not the form: if `Source` lacks `Email` or `Brand` lacks the site, the writer must report it, never invent an option.
- **Spam** is a Status, not a deletion.
- A form field with no column of its own goes to `Details`, one `Label: value` line each. Secrets and honeypot fields never.

## What the core does with leads

1. **Reads them** (read only): `notion-dump leads <project>` (token) prints the counts by Status, Brand and Source and three lists that mirror the live views: *needs reply* (New or no status, received before today), *overdue* (In progress, Next step before today), *won without a client*. A session without a token reads the same rows through the Notion connector and applies the same three rules.
2. **Shows them** (P97 S2): the server's Leads reader (`apps/server/src/clients/leads-reader.ts`) lists the project's Leads with the hub token at start, every 15 minutes, and at once when the Mail reader sees a new lead notice. Mail ▸ Inbox has a **New leads** group below the clients who wrote (P98: a client who wrote is a conversation in progress, so it comes first): Status New or empty, received in the last `leads.window_days` (default 14), one row per person, not dismissed and with no draft yet; older New rows are one muted count the Hub never writes. `lead_rows` keeps decision 0013's minimum (page id, name, the reply address and the account email, brand, when, the Status as read, 120 characters of the Message, the person's own words: never Details, the form's metadata, P98; and since P138 four short facts of the form for the list row: the website or first site, the country, the segment, the expected volume, 60 characters each); the card reads the page from Notion when it opens and shows the form itself (P138): what they want first (known Details labels in a fixed order, then every other label), the contact channel and the sites they named, the agent's read from `Conversation summary` on top, the checks before a reply (a mistyped domain from a fixed list, a client with the address or the company's domain, the forms one address sent), and the technical lines (locale, hosts, consent, environment, tracking) last and smaller, never folded. Mail ▸ Leads (P134, P138): a views control in the list header (New, Not now, Spam, Replied), the rows grouped by day. No token: the line says so and the dock reads Leads through the connector.
3. **A notice is never a person** (P97 S1): the mail a site's backend sends when a form lands (a sender on `leads.notice_senders`, or a machine address the mail filters whitelist, such as `robot@…`) is never an Inbox client row and is never answered. It only makes the Leads reader read at once.
4. **Drafts for them** (P97 S3): the lead card's Prepare reply pastes the bulk-drafts first-mail phrase into the dock; the agent writes a **new thread** to the lead's reply address (the email typed on the form, the `Contact channel: Email: …` line of Details, else the Leads `Email`), signed as `Lead.Brand` (`draft_write`'s `brand`). `draft_write` admits a Leads row (Status not Spam) as a known person. A lead with only a phone or Telegram gets no mail draft. `triage-mail` step 3b and the workflow `new-website-lead` stay for a lead that wrote by mail.
5. **A Clients card at the first reply sent** (P97 S4, decision 0044): after a confirmed send to a stored lead, before the P89 stamp, the server links the lead's Clients card (exactly one with that Email or Other emails), creates one (none: Relationship Lead) or says that several have the address, and sets Status New to In progress. Not at arrival (spam would fill Clients), not at the draft. A refusal (403: Insert content or Update content missing) is a note on the lead card and the doctor's `notion lead writes` row, never a failure of the send; `notion.convert_leads off` writes nothing.
6. **Spam** (P97 S5): the card's Spam sets Status Spam, Undo sets New. The agent may propose it, never set it.

Whether a form still delivers a lead at all (page, CSP, endpoint, the signed canary) is a separate check: [22-lead-forms.md](22-lead-forms.md).

## Access

Which integration needs access to Leads and Clients (the backend that writes, the hub that reads) and how to share it: [`../setup/access.md`](../setup/access.md). `hub doctor` fails `notion.access` on `leads` when the hub's integration cannot see it.

Update this page when the architecture changes.
