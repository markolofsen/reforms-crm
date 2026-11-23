---
name: Request for a quote or proposal
status: Draft
run_mode: Agent may pick
applies_to: ["Lead", "Client", "Partner"]
description: "Use when someone asks what we do, what it costs, or whether we can take on a project: collect what is missing and propose the next step."
---

# Request for a quote or proposal

### Goal

The sender gets a useful first answer and a clear next step, and we learn what we need to quote.

### Input

The email and what the knowledge base says about services and prices.

### Steps

1. Search the knowledge base for services, process and any price statement (`knowledge_search`, hub). Use only entries with `use: STATE`, `approved: true`, `expired: false` and audience LEAD or ANY (or the sender's audience).
2. List what is missing to quote: market, scope, timing, budget range, who decides.
3. Draft: thank them, say in two sentences what we can do for that case, ask the two or three most useful missing questions, propose a call with two time options if Knowledge says calls are offered.
4. If the knowledge base has no price: say a person will confirm price after the call. Never invent one.

### Do not

- Quote prices that no knowledge entry states.
- Send. Draft only.
- Send attachments.

### Done when

A draft exists with the missing questions and a next step.

### Report back

The draft and the list of questions asked.
