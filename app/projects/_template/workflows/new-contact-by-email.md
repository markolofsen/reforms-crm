---
name: New contact by email
status: Draft
run_mode: Manual
applies_to: ["Lead"]
description: "Use when the sender of a genuine human enquiry is not found in Clients or Leads: create one Lead with Source Email."
---

# New contact by email

### Goal

An unknown person who really wrote to us is captured once as a Lead with the source Email.

### Input

The classified message from "Triage an incoming email" with the decision "genuine enquiry, sender unknown".

### Steps

1. Search Clients and Leads by Email once more. If found, stop and use that row.
2. Create one row in Leads: Name = sender's name or company, Email, Source = Email, Status = New, Received at = message date, Message = one-sentence cleaned summary of the ask.
3. Leave Owner, Client and Next step empty for a human.
4. Start the Conversation log on the new page with the first line.

### Do not

- Create a Lead for noise, spam, newsletters or automated mail.
- Create rows in Clients.
- Create a second Lead for the same email address.

### Done when

Exactly one Lead exists for the address, Source is Email.

### Report back

The Lead link and the one-sentence ask.
