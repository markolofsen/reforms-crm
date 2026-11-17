# 14. Bulk-send interface (a colleague's reply helper, done well)

Status: owner ask 2026-11-14; template path built 2026-11-14 (see a decision or plan record kept in the owner's instance); agent path built 2026-11-14 (skill `bulk-drafts`, gate stage, tested with a fake runner, not live); Sent detection built 2026-11-14 and, since P14, covering drafts a session recorded with `hub record-draft` as well as bulk ones (`drafts.awaitingSent` no longer requires a batch; the match is by message-id, thread, or subject plus recipient) (read-only IMAP reader, `drafts.markSent` the only writer of `sent`, a reconciler in the server; fakes only, no real mailbox read); IMAP draft append and the Sent log screen not built. Built details: safety results are computed at read time (rules are data: defaults in `@hub/config`, per-project overrides in `safety_rules`; only acknowledgements are stored); changing a draft's tone clears Checked; `skipped` is a settable status; migration 0004 adds `batches`, `safety_rules` and the batch columns on `drafts`; one open draft per client (partial unique index); no route or status can send. Refs: the colleague's helper files in the owner's reference material (custom layer), the owner's reference material.

## One queue (P27, 2026-11-18)
Drafts is the only place a draft is reviewed. A batch is a filter on it (`/drafts?batch=3`), the builder opens as a pane (`/drafts?new=1`), and the `/bulk` route, its nav entry and the `g b` chord are gone. The list searches on the server (name, address, subject; the counts beside the views never narrow by the search), shows "7 of 40 · 3 done, 1 sent, 14 to go", and below 640 px keeps one sticky line (view menu, search, Select). Clients the agent did not answer by email (a call to make, no reply needed, crossed off, unknown sender) are recorded with `kind` and an optional free-text `phone` (migration 0015) and listed read-only under "Not by email (N)"; they never enter the reply queue, and nothing in that path sends. `hub dev` seed: `seed-cli --many 120` adds a long list for manual viewing.

## Per-client rule (P28, owner 2026-11-15)
Even in a batch every reply is individual. The Bulk template mode (one text rendered for N clients, `renderTemplate`) is replaced by a **brief** mode: the owner's text is the purpose and tone for the agent, never a body, and the hub renders no body from it (tone versions change tone, not content). The agent first reads each client's thread and profile: `skills/triage-mail/references/per-client.md`; design a decision or plan record kept in the owner's instance, plan a decision or plan record kept in the owner's instance (code change C5 landed 2026-11-16: no `mode`, no template columns, migration 0013; a batch is created queued with its brief and the agent writes the drafts through the gate).

## Purpose
A section of the local admin app (`06`) where one person reviews and sends many prepared replies quickly and safely: the agent prepares drafts with the reason for each, the person checks and presses Send in Mail. An earlier hosted app tried this and was poor; this takes the best of the helper files and fixes what hurt.

## What the reference helpers do (read from `seller-email-replies-2026-11-05.html`, 19 drafts; the buyer file has 432)
- Queue ordered by: replies owed first (they wrote last), then deal value, then longest silence. Filters with counts: All, Ready, Hold, Replies owed, High value, Done, Sent. (Our app, decision 0009: the same order without deal value, and no High value filter, because Notion owns the client record and the admin database keeps no value or company.)
- A card per client: header (name, state chips Reply owed / Ready / Done), "last contact N days ago (they wrote, date)", the subject line, From / To / Cc, **Why this email** (the history in two sentences: source, dates, promises), **Safety checks** (Cc present, everyone on the thread, quoted text mentions a risky word such as HOA, last real contact, which thread the reply goes in).
- Up to three tones per draft: short / standard / warm (keys 1 2 3). Not every draft has all three: 418 of 432 buyer drafts do, 1 of 19 seller drafts (see the helper spec in the owner's reference material (custom layer)).
- Keyboard: J/K next/previous, C checked, R reply-all + copy, D done and jump, P paste what I sent, / search, ? help. "Checked" turns the amber button green; Send is gated by it.
- Reply All opens the Mail reply window and puts the formatted HTML on the clipboard; the person pastes and sends. After sending, D, or paste what was sent, and the sent text is logged.
- Side lists: "Crossed off" (not qualified / not interested / no value, with who said it and when), "Who are these?" (unknown senders resolved with what is known, including a do-not-contact flag from the CRM), "Still looking" (people the notes mention but the mailbox cannot find), a call list (no email found).
- State saved in the browser and, with a local helper, in a file next to the build (`/state`, `/reply`, `/log`, `/ping` endpoints): this is what becomes our server and SQLite.
- Copy all remaining subjects; download the sent log.

## What to fix (why the hosted version was poor, as far as the files show; confirm with the owner)
- Static build per batch (a 7.5 MB HTML for 432 drafts): replace with a live app on SQLite, paged, searchable, one queue for every batch.
- State in a browser plus a side file: one source in SQLite, shared by the agent and the UI.
- Clipboard-and-paste send: keep it for Mail (no send path by design), but remove the manual steps that can go wrong: the app opens the draft already created in Mail by the agent (IMAP `\Draft` append or Mail MCP), the person edits and sends in Mail; the app marks Sent only when the sent message appears in Sent (IMAP check), not on a keypress.
- Safety checks are prose now: make them typed rules (`cc_present`, `unknown_recipients`, `do_not_contact`, `risky_word`, `wrong_thread`, `already_sent_recently`) that block Checked until acknowledged; the list of rules is data, edited by the owner.
- Marks and crossed-off reasons come from the client profile, not from hand-built sections.

## Screens (one screen per job, English, coss, no dialogs)
1. Queue: filters with counts, ordered list, bulk select ("all matching"), bulk actions: hold, cross off with reason, request redraft, assign tone.
2. Review card: why, history chain (the `mail_history` of the client, inline), three tones, safety rules list, Open in Mail, Checked, Done.
3. Batch: define a batch (filter + intent: follow-up to silent clients, notice to a segment), agent drafts, queue fills; progress and cost shown.
4. Sent log: what was actually sent (from Sent folder), per batch.
Keyboard map copied from the helper; a `?` overlay.

## Data (SQLite, `packages/db`)
`batches`, `drafts` (client_id, batch_id, state ready/hold/checked/done/sent/crossed_off, tone variants, reason text, safety results JSON, mail_ref), `safety_rules`, `sent_log`. Marks reuse client marks from `06`.

## Work plan (tracks in a decision or plan record kept in the owner's instance)
1. Inventory the three HTML files fully (every state, rule, text pattern) into the helper spec in the owner's reference material (custom layer); extract the 19-draft file as a fixture set (anonymise before any commit).
2. Define the draft and safety-rule schema (`packages/db`), with fixtures from step 1.
3. Queue screen with filters, order, bulk selection (needs TanStack Table v9 spike, decision 0001).
4. Review card with history chain and tones; Open in Mail via the draft the agent created (needs IMAP draft append, decision 0002).
5. Safety rules engine as data + tests on the fixtures (each rule must fire on the helper's own examples).
6. Sent detection via the Sent folder; sent log.
7. Batch creation and the agent skill that drafts a batch with reasons (`skills/`), draft-only enforced.
8. Walk-through with the owner on real data; squeeze: remove any control not used in a week.
Acceptance: 20 drafts created, reviewed by keyboard only, 0 sent by the agent, sent state matches the Sent folder.
Depends on: P3 (skeleton and DB), P1 (real skill run), the IMAP choice in `0002`.

Update this page when the architecture changes.
