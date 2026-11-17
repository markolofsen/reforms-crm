---
name: New website lead
status: Draft
run_mode: Agent may pick
applies_to: ["Lead"]
description: "Use when a new request arrives in Leads (Status New or empty) and needs sorting: real or spam, known client or new, who handles it, what to reply."
---

# New website lead

## Goal

Every new request is sorted the same day: real or spam, known client or new person, who handles it and what happens next.

## Input

One row in Leads, usually from the Inbox view. To see the whole queue (needs reply, overdue, won without a client) run `notion-dump leads`; the field contract is `@docs/core/21-leads.md`. If the user gives a name, email or phone instead, find the lead by it. If several leads match, ask which one.

## Steps

1. Read Name, Email, Phone, Message, Form, Page URL, Received at.
2. Spam check. Ads, link-only messages, gibberish or no way to reply: propose Status = Spam and stop.
3. Known person?
   - If Client is set, open that person in Clients and read Relationship, Deals, open Tasks, Owner note and earlier Leads.
   - If Client is empty, search Clients by Email, then by Phone. Exactly one match: propose linking it. None or several: leave Client empty and say so.
4. Summarize the request in 2–3 lines: what they want, market or program if mentioned, how urgent.
5. Draft a short reply in the sender's language. Put it in the lead page body under the heading "Draft reply".
6. Propose an Owner and a Next step date (today or the next working day).
7. After the user confirms: set Status = In progress, Owner, Next step, and Client if a match was confirmed. If the person is linked and there is real work, create a task in Tasks with Client set.

## Do not

- Send emails or messages. Draft only.
- Change intake fields: Email, Phone, Message, Form, Page URL, Received at, Source, Hub run id, Brand, Mailbox.
- Create rows in Clients. Clients comes from the CRM.
- Overwrite a Client someone already set.

## Done when

Status is no longer New (or Spam was approved), Owner and Next step are set, and the draft reply is on the page.

## Report back

3–5 lines: who it is, what they want, known or new, the proposed reply, and what you changed.
