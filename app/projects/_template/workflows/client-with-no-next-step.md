---
name: Client with no next step
status: Draft
run_mode: Agent may pick
applies_to: ["Client", "Deal"]
description: "Use when an active client or open deal has no open task (the No task tabs), or the user asks what to do next with a specific client."
---

# Client with no next step

## Goal

Every active client and open deal has one clear next action with a date.

## Input

One person from Clients or one deal from Deals. If the user asks about several, handle them one by one and show a short list at the end.

## Steps

1. If Do not contact is checked, stop and say so.
2. Read the person: Relationship, Activity, Last two-way contact, Last inbound, Last outbound, Waiting since, Deals, Open loop items, Owner note, Next step, Leads.
3. Decide which situation it is:
   - We owe them something (open loop, unanswered inbound): the next action is to deliver it.
   - We are waiting for them (Waiting since is set): a polite nudge, timed by how long we have waited.
   - Quiet: a useful reason to get in touch (news in their market, a deal update), not a generic check-in.
4. Propose one next action and a due date. If it means writing to them, draft the message.
5. After the user confirms, create the task in Tasks with Client set, and Deal if it is about a deal.

## Do not

- Edit fields filled by the CRM.
- Send messages.
- Create more than one task per person unless the user asks.

## Done when

The person or deal has an open task with a due date and drops out of the No task tab.

## Report back

One line per person: situation, the action, the due date.
