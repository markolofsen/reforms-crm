---
name: sort-chats
description: Use when the owner wants the unlinked Telegram and WhatsApp chats of one project sorted ("разбери чаты", "sort the chats"): read the chats linked to no client and propose "Hide: not a client" for those that are not, each with its reason. Nothing is hidden, linked or sent; the owner confirms the list once on Messengers ▸ Not linked.
allowed-tools: mcp__hub__focus mcp__hub__project_show mcp__hub__chats_unlinked mcp__hub__chats_propose_hide
---

# Sort the chats (manual run, one project)

> Layer: **core** (universal). Names in this file are examples; one owner's facts live in `projects/<slug>/` (custom). Rule: `@docs/LAYERS.md`.

The owner started this session and said the instruction (P128 X5). Replies to the owner in Russian, briefly.

## 0. Bind the session
Exactly as `skills/triage-mail/SKILL.md` section 0 (the slug, `project.md`, one project per session).

## 1. Read
`chats_unlinked` (hub): every chat the Hub saw that is linked to no client, by its title, why no record matched (`none`, `ambiguous`, `no_email`, `off`, `failed`) and the newest message's time and side. You never see a message's text, and you do not search for one.

## 2. Decide per chat
- Not a client: a shop, a delivery, a bank or a service's notices, a bot, a group or channel, spam, an obvious private contact (family, a friend's nickname). Propose it.
- A possible client (a person's name, `ambiguous` or `no_email`: a record matched but could not be linked): leave it alone. The owner links it.
- A chat already `proposed`: skip it.
- In doubt: leave it alone. A wrong hide costs him an Undo; a missed client costs a deal.

## 3. Propose
One `chats_propose_hide` call with every chosen chat: `channel`, `chat_id` and a reason of one sentence in English that he reads in the dialog ("A pizza delivery's order notices."). It hides nothing.

## 4. Report
One line in Russian: how many chats you proposed of how many unlinked, and where he confirms them ("Messengers ▸ Not linked ▸ Review"). Then "Ничего не скрыто, ничего не отправлено."
