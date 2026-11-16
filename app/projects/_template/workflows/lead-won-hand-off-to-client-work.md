---
name: Lead won: hand off to client work
status: Draft
run_mode: Agent may pick
applies_to: ["Lead", "Client"]
description: "Use when a lead is marked Won, or the user says a request turned into a real client: make sure the person is in Clients, link the lead, and set up the first tasks."
---

# Lead won: hand off to client work

## Goal

A won request becomes normal client work: the lead points to the person in Clients and that person has an open task.

## Input

One row in Leads with Status = Won, or a lead the user names. The "Won, no client" view lists the ones still missing a link.

## Steps

1. Open the lead. If Client is set, go to step 3.
2. Search Clients by Email, then by Phone.
   - Exactly one match: link it as Client.
   - No match: the contact has to be created in the CRM first. Tell the user, add "Waiting for CRM contact" to Notes, and stop. The lead stays in "Won, no client" until the sync brings the person in.
   - Several matches: list them and ask the user which one.
3. Open the person in Clients. Read Deals, open Tasks and Owner note.
4. If the person has no open task, create one in Tasks: Client = the person, a clear action as the title (for example "First call with …"), Due = the lead's Next step or the next working day. Add the Deal if one is clearly related.
5. Summarize in 2–3 lines what the client asked for in the original request, so the task owner has context.

## Do not

- Create or edit Clients, Deals or Organizations. They are filled by the CRM.
- Send emails or messages.
- Overwrite a Client someone already set.

## Done when

Lead.Client is set and the person has at least one open task with a due date, or the lead is clearly marked as waiting for the CRM contact.

## Report back

Who, which task you created and when it is due, or what is blocking.
