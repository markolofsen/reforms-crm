---
name: bulk-drafts
description: Use when the owner wants to write to clients of one project on his own initiative, one client or a group (a follow-up, a notice, a campaign to all clients, "write to him again", a first message to a client never written to), even when the client has not answered or our last mail was sent. Produces one reviewable unsent draft per client in that client's latest thread (a new thread when there is none), plus a table, only for recipients the project admits; a group is one batch in Drafts. Never sends and never invents facts. Unlike triage-mail, which answers whatever clients wrote, this starts from the owner's own purpose.
allowed-tools: Read Write Bash mcp__notion__notion-fetch mcp__notion__notion-query-data-sources mcp__mail-mcp__list_mailboxes mcp__mail-mcp__find_messages mcp__mail-mcp__get_message_content mcp__mail-mcp__list_drafts mcp__hub__project_show mcp__hub__mail_list mcp__hub__message_show mcp__hub__client_show mcp__hub__draft_show mcp__hub__draft_write mcp__hub__client_record mcp__hub__focus mcp__hub__knowledge_search mcp__hub__knowledge_get
---

# Bulk drafts: writing on the owner's initiative (draft-only, one batch, one project)

> Layer: **core** (universal). Names and addresses here are examples; one owner's facts live in `projects/<slug>/` (`@docs/LAYERS.md`).

The owner said who and why ("follow-up всем лидам acme, кто молчит больше 2 недель"). Choosing the clients is this skill's job:
the admin has no batch builder, so never send him there to pick. The result shows by itself: every draft in the admin's Mail
and the run as one session in Activity.

1. Bind the project as `skills/triage-mail/SKILL.md` section 0 does (`project_show`).
2. **Who.** "выбранные / the selected ones" (P51): the rows `focus` lists as selected (up to 50, and how many more); exactly
   those clients, nobody else. `none` or `stale`: ask in one line. Otherwise query the project's Notion `clients` data source by
   the id `project_show` gives (never a Notion search), filtered as he said (Relationship, a brand, a list of names). A client
   named alone is a list of one. Only addresses `draft.recipients` admits (`project_show`); the rest are skipped and reported.
   Cap 30 unless he gave a number; say what was left.
3. **The brief.** His phrase gives purpose and tone; it is never a body: do not paste, fill in or lightly edit it. His words,
   verbatim, are `owner_request` on every `draft_write` of the run (the hub finds them in the session log). One `batchKey`
   (`bulk-<date>-<time>-<3 random chars>`) and one `batchTitle` (a short English campaign name, at most 60 characters) in the
   `context` of every record: the run is one batch in Mail (View menu, Batches) and one session in Activity. Every client then
   goes through `skills/triage-mail/references/per-client.md` P1 to P7 in full, with the brief as the purpose: profile read,
   history (newest 3 both directions plus the message answered), facts (`knowledge_search` in that client's words, then a
   placeholder; `skills/triage-mail/references/kb-gaps.md`), a body with an anchor only that client has. No body before P1 to
   P3. An empty or absent profile is still drafted from the thread, and listed as P3 and a `profile-empty` gap.
4. **One draft per client**, never a sign-off of yours (the hub signs): where it goes (a reply to the newest message, a new
   thread, a Notion lead), reruns, a teammate's reply, and the record: `references/where-to-write.md`.
5. **KB gaps** across the batch (`kb-gaps.md` sections 2 and 3); the same missing fact for several clients is one
   `repeated-question` gap. Any: write `projects/<slug>/reports/kb/YYYY-MM-DD-bulk.md` (inside `reports/` only; nothing to Notion).
6. **Report** in the format of `skills/README.md` ("Report"), with the evidence column. Above 5 clients use the subagent rule of
   `skills/triage-mail/SKILL.md` section 4.
7. **Batch check:** above 3 clients `hub audit-run` (triage-mail section 5), and always
   `hub batch-check --project <slug> --batch <batchKey>`; a red row is P1 in "Нужно от тебя".
8. **Sending is his:** one click per draft in Mail, or Send all Checked in the batch view (only the drafts he ticked, after one
   confirmation naming each recipient, through the send door with every guard). You have no send tool. Last line: "Черновики в
   Drafts, батч «<его слова>»; ничего не отправлено: отметь Checked и отправь сам (по одному или Send all Checked)."

A client whose answer is a phone call is recorded with `client_record` and `kind: "call"` (and `phone` when the mail states one),
not drafted. Bulk drafts never propose times: a client asking for a call or meeting is `skipped: scheduling, see calendar`
(`skills/calendar/references/from-mail.md`).
