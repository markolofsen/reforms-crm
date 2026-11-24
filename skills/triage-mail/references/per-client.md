# Per client, always (P1 to P7)

Shared by `triage-mail` and `bulk-drafts`. Owner rule: every reply is written for that client alone, from that client's own thread and profile. The procedure is the same for 1 client or 300, in the main session or in a subagent; a big batch, a small context or a short owner phrase never shortens it. A template, a purpose or a tone fixes WHAT the message is for and HOW it sounds. It is a brief, never a body.

| Step | Do | Tool |
|---|---|---|
| P1 Profile | Read the client's record: query the project's `clients` source by `Email` (or `notion-fetch` the page). Result is `filled`, `empty` (page without durable facts) or `absent` (no row). Empty or absent is a result: report it as a gap, answer from the thread alone, never as if the profile were fine. Writing the profile stays at the last step. | `notion-query-data-sources`, `notion-fetch` |
| P2 History | `find_messages` by sender on the project's account (inbound); the project's Sent mailbox for what we wrote after their newest (outbound). Open with `get_message_content` the newest 3 messages across both directions, plus the message being answered, plus every message the body cites. Fewer than 3 exist: open all. First contact only after the search returned nothing. | `find_messages`, `get_message_content` |
| P3 Facts | `knowledge_search` with this client's own words (1 to 3 queries), for this client; in an attended session grepping the entry files is fine too. Facts only from usable entries of this client's brand or `ANY`, each opened with `knowledge_get` before it is stated (the ledger credits only the tools until P140); everything else is `[Owner: ...]` (`kb-gaps.md`). | `knowledge_search`, `knowledge_get` |
| P4 Write | Purpose and tone are the brief. The body states at least one anchor, a concrete item that exists only in this client's thread or profile, and answers what the client asked or fits where the thread stands. | none |
| P5 Draft | One unsent `draft_write` (hub) on the client's newest message; it adds the marker line (`triage-mail` section 2 step 5). | `draft_write` |
| P6 Record | `draft_write`'s `record` (or `client_record`) with honest counts (what you opened, not what you meant to). Say "recorded" only on `recorded: true`. | `draft_write` |
| P7 Profile and log | Notion profile and the one log line (`triage-mail` section 2 step 7). Last, append-only. | `notion-update-page` |

The evidence you must be able to state for every draft: messages found and opened (ids), first contact yes or no, profile state, facts used and missing, the anchors, and which opened messages the body relies on.

Forbidden shortcuts, each a defect even if the draft looks fine:
- "same as client N", or a body copied from another client with the name changed;
- writing from a list of names and the purpose without opening the thread;
- one `knowledge_search` for the whole batch, reused;
- opening only the newest message because the batch is large;
- treating a tone, a greeting or the signoff as the personal part;
- a first-contact claim without the empty search;
- skipping the profile read because it was empty last time.
- a follow-up that only says "just checking in" or "following up on my last email" (P47: every follow-up step brings something new from the thread or the knowledge).

Counts honesty: the hub compares your counts with what the session observed; a count above what you opened is reported to the owner as a mismatch.
