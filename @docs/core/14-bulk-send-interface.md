# 14. Bulk drafts and the review queue

Status: built. A section of the local admin app (`06`) where one person reviews many prepared replies quickly and safely: the agent prepares one draft per client with the reason for it, the person checks each one and sends it one at a time. Nothing here sends in bulk, and no route or status can send on its own.

## One queue
Drafts is the only place a draft is reviewed. A batch is a filter on it (`/drafts?batch=3`) and the batch builder opens as a pane (`/drafts?new=1`); there is no separate bulk screen. The list searches on the server (name, address, subject; the counts beside the views never narrow by the search), shows "7 of 40 · 3 done, 1 sent, 14 to go", and below 640 px keeps one sticky line (view menu, search, Select). Clients the agent did not answer by email (a call to make, no reply needed, crossed off, unknown sender) are recorded with `kind` and an optional free-text `phone` (migration 0015) and listed read-only under "Not by email (N)"; they never enter the reply queue, and nothing in that path sends. `hub dev` seed: `seed-cli --many 120` adds a long list for manual viewing.

## Per-client rule
Even in a batch every reply is individual. A batch carries a **brief**: the owner's text is the purpose and tone for the agent, never a body, and the hub renders no body from it. The agent reads each client's thread and profile first (`skills/triage-mail/references/per-client.md`), through the `bulk-drafts` skill. A batch is created in the admin with its audience (`all`, `owed`, `silent`, `follow_up`, `vip`), its intent (`follow_up`, `notice`, `custom`) and its brief; a client who cannot be picked (do not contact, an open draft, not in the project) is left out and the reason is said once, in the "Left out" line.

## The review card
- Up to three tones per draft (`drafts.tones`; short / standard / warm, keys 1 2 3); changing the tone clears Checked.
- Safety results are computed at read time from rules that are data (`SAFETY_KINDS` in `@hub/config`, for example `do_not_contact`, `cc_present`, `unknown_recipients`, `risky_word`, `wrong_thread`, `already_sent_recently`, and the evidence checks of what the draft was based on); defaults live in `@hub/config`, per-project overrides in `safety_rules`, and only acknowledgements are stored. A red result blocks Checked until acknowledged.
- Send is gated by "I read the checks"; the card, its states and keys are in `06`.

## Sent detection
A recorded draft (bulk or not, `hub record-draft`) is matched to the Sent folder by message-id, thread, or subject plus recipient: the read-only IMAP reader in `app/packages/mail` (`readSent`, `matchSent`), a reconciler in the server, and `drafts.markSent` the only writer of `sent`. Not built: appending a draft over IMAP, and a per-batch sent log screen (the Project screen shows the send history).

## Data (SQLite, `packages/db`)
`batches` (audience, intent, brief, the picked and the excluded clients), `drafts` (status `ready hold done sent skipped`, the `checked` flag, `tones`, `reason`, `safety` and `acked`, `mail_ref`, `batch_id`; one open draft per client, a partial unique index), `safety_rules`, `send_log`. Marks are the client marks of `06`.

Update this page when the architecture changes.
