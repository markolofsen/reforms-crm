---
name: Triage an incoming email
status: Draft
run_mode: Agent may pick
applies_to: ["Lead", "Client", "Partner"]
description: "Use when an email arrives and it is not yet clear whether it needs an answer: real person or noise, which person, how urgent, what they want."
---

# Triage an incoming email

### Goal

Every incoming email is classified once: needs a reply or not, who the sender is, how urgent, and whether it belongs in Notion.

### Input

One email (sender, subject, cleaned text). Find the sender by Email in Clients, then in Leads.

### Steps

1. Drop noise before reading: quoted history, signatures, legal footers, tracking text, tables of numbers that are not part of the question.
2. Is it automated? Newsletters, receipts, notifications, out-of-office, bounces, no-reply senders: mark "no reply needed" and stop.
3. Is it spam or a mass mailing with no way to answer? Mark "no reply needed, spam" and stop.
4. Find the sender: Clients by Email (lowercase), then Leads by Email. From Clients read Grade, Do not contact, Relationship and Conversation summary. Leads has only Conversation summary: for a Lead treat Grade as empty (Standard), Do not contact as unticked and Relationship as unknown, and say so in the report. If the sender matches both a lead and a person, use the person.
5. If Do not contact is ticked on the person: stop, report it, draft nothing.
6. Classify: intent (question, request, complaint, payment, scheduling, thanks, other), urgency (today, this week, no rush), sensitive (legal, money, complaint, personal data), language.
7. Decide: reply needed? add a line to the Conversation log? create a Lead (only for a genuine first enquiry from an unknown sender)?

### Do not

- Send anything.
- Create a row in Clients.
- Treat an unknown sender as Low grade.
- Decide on automatic sending. That is a separate gate.
- Write to any row. Triage only reads and classifies; creating a Lead is the workflow "New contact by email", and the log is "Keep the conversation digest".

### Done when

The message has intent, urgency, sensitivity, language, a reply/no-reply decision and a sender match (or "unknown").

### Report back

3 lines: who, what they want, reply or not and why.
