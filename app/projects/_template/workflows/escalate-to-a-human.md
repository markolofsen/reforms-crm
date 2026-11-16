---
name: Escalate to a human
status: Draft
run_mode: Agent may pick
applies_to: ["Client", "Lead", "Partner", "Deal"]
description: "Use when an email is a complaint, a legal or payment matter, a refund or cancellation, a threat, or anything involving money or personal data: do not draft an answer, hand over."
---

# Escalate to a human

### Goal

A human sees the sensitive message quickly with the context needed, and no automatic reply goes out.

### Input

A classified message with sensitive = true, or intent complaint, payment, legal, refund, cancellation.

### Steps

1. Propose a Task in Tasks: title "Reply by hand: \<person>, \<topic>", due today, priority High, Area set to the area used for client work, Client or Deal set if known.
2. Write a three-line brief in the task: what they said, what they want, what the person's page says about earlier contact.
3. Create the task after a person says OK.
4. Do not draft a customer-facing answer, except a one-line holding reply if the owner asks for it.
5. Mark the message "no automatic reply" in the report.

### Do not

- Reply to complaints, legal or payment questions automatically.
- Admit fault, promise refunds or quote terms.
- Create a task without Area.

### Done when

A High priority task exists with the brief, and the message is marked as human-only.

### Report back

The task link and the three-line brief.
