---
name: sequence-drafts
description: Use when the owner asks to prepare the follow-ups that are due in one project. Reads the due steps from the hub, re-checks each client's mail and profile for a reply, a bounce, an opt-out or an out-of-office, then leaves one unsent draft per step that may still go, written for that client from the sequence file's step. Never enrols, pauses or resumes, never sends and never writes Notion. Unlike bulk-drafts, which starts from the owner's own purpose for a group, this follows the steps the owner already enrolled.
allowed-tools: Read Bash mcp__notion__notion-fetch mcp__notion__notion-query-data-sources mcp__mail-mcp__list_mailboxes mcp__mail-mcp__find_messages mcp__mail-mcp__get_message_content mcp__mail-mcp__list_drafts mcp__mail-mcp__create_reply mcp__knowledge-mcp__knowledge_search mcp__knowledge-mcp__knowledge_get
---

# Sequence drafts (the due follow-up steps, draft-only, one project)

> Layer: **core** (universal). Names in this file are examples; one owner's facts live in `projects/<slug>/` (custom). Rule: `@docs/LAYERS.md`. The engine: `@docs/core/23-sequences.md`.

Rules: `skills/README.md` ("Rules"). Talk to the owner in Russian, briefly. Manual-first: the owner enrolled every client in the admin (Drafts, Follow-ups) and started this session. **You never run `hub sequences enrol`, `pause` or `resume`** (they are denied, and the hub refuses them in a session). You may only reduce mail: `stop`, `delay`, `judge`.

1. **Bind** as `skills/triage-mail/SKILL.md` section 0 (one project per session).
2. **Read what is due:** `./run.sh sequences due <slug> --json`. Each row gives `enrollmentId`, the client, `step` of `steps`, `lastStep`, `replyTo` (our newest message: subject, `mailRef`), `stepRow` (the step's purpose, angle and length from the file), `optOut` (step 2 and later), `languages`, and `changedSinceEnrolment`. Read the sequence file `projects/<slug>/sequences/<id>.md` once for its Goal and "Do not" lines. Nothing due: say "по проекту <slug> follow-up не нужен" and stop. Cap 30 rows; say what was left.
3. **Per client, before any text** (`skills/triage-mail/references/per-client.md` P1 to P3):
   - P2 history: the client's inbound since `replyTo.sentAt`, and a bounce (a delivery failure to this address) since then.
   - P1 profile (read only): Notion's do-not-contact or do-not-follow-up, Relationship, Lead Status.
   - Then put what you read through the stop rule: `echo '<facts>' | ./run.sh sequences judge <slug> --id <enrollmentId>` with `{"lastInboundAt":...,"bounced":...,"optedOut":...,"outOfOfficeUntil":...,"doNotContact":...,"doNotFollowUp":...,"relationship":...,"leadStatus":...}` (only what you read; leave the rest out). `"finish"` or `"delay"` in its answer: the hub has already stopped or delayed it, report the row as `skipped:<reason>` and draft nothing. `"continue"`: go on.
   - A message that only says "remove me" or "stop" is an opt-out (`"optedOut":true`). An automatic out-of-office reply gives `outOfOfficeUntil` (its return date).
4. **Write** (P3 to P4): the step's purpose and angle are the brief, never a body. New value from that client's thread and the project's knowledge (facts only from `knowledge_search`, else `[Owner: ...]`). No "just checking in", no "following up on my last email", no guilt, no invented deadline. Step 2 and later end with the file's `optOut` sentence, word for word in the client's language. `lastStep`: the closing line the file gives, then nothing more.
5. **Draft** (P5): one unsent `create_reply` (`reply_to_all` false) on our message `replyTo.mailRef`, marker line first `[hub-draft thread=<Message-ID>]`. Skip a client whose marker is already in `list_drafts`. If no reply can be made, report `skipped: no-message-to-reply` and give the text in chat.
6. **Record** (P6): `hub record-draft` as `skills/triage-mail/SKILL.md` section 2 step 5, with `"skill":"sequence-drafts"`, `mailClass` of our message, and `"sequence":{"enrollmentId":<id>,"step":<step>}`. The hub refuses a step over another open draft of the client: report that row `skipped: open-draft`. A step is **never sent by the hub** (`hub send` refuses it in every mode); the owner sends it from Mail.
7. **No Notion write** in this skill: the profile and the log stay as they are.
8. **Report** in the format of `skills/README.md` ("Report"); `действие` per row is `drafted`, `skipped:replied`, `skipped:bounced`, `skipped:opted_out`, `skipped:closed`, `skipped:excluded`, `skipped:out_of_office` or `skipped:<code>`. `changedSinceEnrolment` true: one P2 line ("файл follow-up <id> изменился после записи клиента"). End with "Черновики лежат в Mail, ничего не отправлено."

Never: send, enrol, pause, resume, write Notion, read another project, or draft a client the judge stopped.
