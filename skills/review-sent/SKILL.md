---
name: review-sent
description: Use when the owner wants the agent to learn from what he really sent in one project. Compares the recorded drafts with the messages in Sent, summarises tone edits and facts he added, and proposes tone and knowledge changes. Read only, local, writes nothing. Unlike kb-review, which works from saved gap reports, this works from the owner's own edits.
allowed-tools: Read Bash mcp__mail-mcp__list_mailboxes mcp__mail-mcp__find_messages mcp__mail-mcp__get_message_content
---

# Review sent (draft versus sent, read only)

> Layer: **core** (universal). Names in this file are examples; one owner's facts live in `projects/<slug>/` (custom). Rule: `@docs/LAYERS.md`.

Rules: `skills/README.md` ("Rules"). Talk to the owner in Russian, briefly. Sent text is private: it stays in this chat, goes to no file and no Notion, and is never quoted beyond a short phrase of the owner's own wording.

1. **Bind** as `skills/triage-mail/SKILL.md` section 0 (one project; Mail account and `mail.sent_mailbox` from its `project.md`). Period: what the owner said, default 14 days.
2. **Recorded drafts** (read only): `sqlite3 -readonly app/data/app.db "select id, to_addr, subject, mail_ref, reason, body, status, sent_at, created_at from drafts where project='<slug>' and created_at >= date('now','-14 day')"` (the `HUB_DB` file when that variable is set). The record keeps who, subject, the message id and at most a short excerpt, not the full text. No rows: say so and stop.
3. **Sent side:** per recorded draft, `find_messages` in the project's Sent mailbox for the same recipient after `created_at`, then `get_message_content` for the match. Match by recipient and subject, never by subject alone. No match: "не отправлено" (still a draft or deleted); do not guess.
4. **Compare** what you can: the recorded excerpt and `reason` against the sent text. If the draft's full text is gone (it was sent from Mail), say that the comparison is partial. Classify each edit: `tone` (warmer, shorter, formal), `fact added` (the owner filled an `[Owner: ...]` placeholder), `structure`, `rewritten`, `sent as is`.
5. **Report** in Russian: a table `# | клиент | правка | что изменил`, then proposals: (a) a `tone` rule for `project.md` as a sentence, (b) facts the owner supplied that belong in the KB, as topics for `что улучшить в базе знаний X`. You change no file; the owner applies or says "запиши".
