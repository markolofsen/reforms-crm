---
name: Draft a reply to a client email
status: Draft
run_mode: Agent may pick
applies_to: ["Client", "Lead", "Partner"]
description: "Use when a person has written to us and needs an answer: read their summary, the knowledge base and the right workflow, then draft a reply for a human to send."
---

# Draft a reply to a client email

### Goal

A short, correct, ready-to-send draft in the sender's language that a human only has to read and send.

### Input

The email thread (latest message and the person's Conversation summary).

### Steps

1. Read the person: Conversation summary, Relationship, Grade, open Deals and Tasks. Leads have no Grade or Relationship; treat them as unknown.
2. Search the knowledge base for the question (`knowledge_search`, hub; in an attended session you may also read the entry files under `projects/<slug>/knowledge/files/` directly). State a fact only from an entry with `use: STATE`, `approved: true`, `expired: false` and an audience that fits the sender (LEAD, CLIENT or ANY). Quote facts, never invent them.
3. If a specific Workflow fits (quote request, scheduling, complaint, payment), follow it for the content.
4. Write the draft: greet by name, answer the question first, then the next step with a date if there is one, sign with the project's signoff. Short. No promises on price, dates or legal matters unless a Knowledge row states them.
5. If the answer is not in the knowledge base: draft a holding reply that says a person will come back, and flag "needs a human answer".
6. Put the draft in the mail client's drafts. If that is not available, show it in the report. Add it to the person's page under "Draft reply" only after a person says OK.

### Do not

- Send. Draft only.
- Guess prices, deadlines or legal terms.
- Reveal other clients, internal notes or the content of other threads.
- Answer a person whose Do not contact is ticked.

### Done when

A draft exists, uses only known facts, and says clearly if a human must add something.

### Report back

The draft, the knowledge entries used, and what a human must still check.
