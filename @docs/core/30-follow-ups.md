# The daily follow-up sweep

Decision 0050, track P142. Clients get our message and may take a long time to answer; the owner asked for the agent to check once a day who is silent, decide when to nudge and when not, and note what it did on the client's profile. This page is the whole mechanism. The rules the agent follows are the skill `skills/follow-up-sweep/SKILL.md`; nothing below judges a message.

## What runs, and when

- **The one timer that starts a model.** Once a day per project, at `follow_ups.at` (project.md Settings, default `09:00` on the Mac's clock), the Hub server runs a sweep. A Mac asleep or a server off at that time runs one **catch-up** sweep when the server is next up and today has no finished sweep. `follow_ups.schedule: off` stops the runs; the default is `daily`. Neither key is protected (not in `send-policy.json`): the sweep sends nothing that the autopilot's protected switches do not already allow (decision 0048).
- **Run follow-ups now** on Overview starts a sweep of that project at once (at most 3 a day per project; a click while one runs joins it).
- **The dock phrase** "проверь молчащих клиентов проекта X" runs the same skill in an attended session: the owner watches, nothing is sent.
- Every sweep is one `follow_up_sweeps` row: the trigger (`schedule`, `button`, `catch_up`), start and end, the counts per decision, the skips and the error. "Last swept" and the day's turn budget are these rows, so a restart refills nothing.

## Who is listed: the silent clients (mechanical)

The server's selector (`packages/db/src/repos/follow-up-due.ts`, pure over fact rows) lists a Hub client of the project (decision 0009: never the Notion pages) when all hold:
- **our** message is the newest across their Mail (the conversation word `waiting`) and their linked chats (`messenger_chats.last_outbound_at` newer than `last_inbound_at`; both outlive the 30-day cache);
- no draft of ours waits for them, in Mail or Messengers;
- not `do_not_contact`, and no open P47 enrolment (the client is the sequence's);
- their plan is due (its next date today or earlier) or they have none; a `stopped` or `handed_over` plan is never listed until it reopens.

A chat in reply mode `off` is left out; `on_request` is listed and the agent hands it over. Unlinked chats are never listed (decision 0049 point 8): the list counts them in one line. A chat marked done (P143) is judged by its own facts: Done removes attention, not follow-up. Order: the oldest next date first, then the longest silence.

## One turn per client

The sweep runs one headless `claude -p` turn per listed client through P139's runner (`claudeBrain`, the `follow_up` kind): the same spawn rules as autopilot, its system prompt the skill's text, `HUB_PROJECT` plus `HUB_FOLLOWUP_CLIENT` (the `clients` row id) binding its `hub mcp`. The server **prefetches** the client's last 30 messages (Mail through the conversation reader, chats through the cache), the plan and its last lines, our last message's Mail ids and whether a chat is on autopilot, and puts them into the prompt as data, so the turn needs no Mail reader.

The turn has exactly nine hub tools, each bound to that client (refusal `followup_other_client`): `client_show`, `client_map`, `message_show`, `knowledge_search`, `knowledge_get`, `draft_write`, `messenger_draft_write`, `follow_up_plan`, `bug_report` (P145: a silent client's last message may be a bug report; section "Bug reports" below). No built-in tool, no mail-mcp, no Notion server, no send tool. `--max-turns 12` and a 120 s wall clock. `packages/agent/test/deny-modes.test.ts` pins the list.

## The decision and the plan

Each turn ends in one of four decisions, written with `follow_up_plan`: **nudge** (a follow-up draft was written in the same turn), **wait** (until `next_check`), **stop** (`no_answer`, `not_interested`, `lost`, `done`, `do_not_contact`) or **hand over** (the owner decides: we owe the next step, money or terms). The tool refuses only a malformed shape (a nudge or a wait without a date) or another client; a nudge without a draft is answered with a hint. A rerun the same day replaces that day's decision.

The plan (`follow_ups`, one row per client per project) is **the agent's notes**: `state` (`waiting`, `stopped`, `handed_over`, `answered`), `next_at`, `waiting_on`, `nudges_sent`, `last_nudge_at`, `channel`, `reason`, `stop_reason`, `tz`, the newest `line`, `decided_by` and `decided_at`. "Nudge ready" (an open nudge draft) and "due" (waiting, its date passed) are derived, never stored. No tool, door or draft check refuses because of a plan (decision 0050 point 4); the removed per-chat rule (`may_nudge`, `nudge_after_days`) is not back under any name.

**Bookkeeping, never judgement** (`packages/db/src/repos/follow-up-hooks.ts`):
- the **count** moves when a draft with `follow_up_n` is sent (the messenger door; Mail's `drafts.markSent`); a skipped draft never counts;
- the **reset**: the client writes after the decision (a stored inbound in a linked chat, an inbound Mail the reader keeps): the plan is `answered`, the count back to 0, any stop cleared, a pending autopilot nudge cancelled;
- the **reopen**: we write after a stop or a hand-over: the plan waits again with no date, the count kept.

## What a nudge may do

- **Everywhere: a draft.** A Mail nudge is `draft_write` kind `reply` to our own last message with `follow_up: {n}`; the owner sends it with his click. Autosend never sends it (`@hub/send` refuses `follow-up-nudge` in `send.mode: auto`). Mail closed: the decision is recorded with today's date and the next run drafts it.
- **In an autopilot chat only** (decision 0048's three switches on, the project mode `on`): the turn's `messenger_draft_write` carries `autopilot: {verdict: send}`, `follow_up: {n}` and `send_after` (an ISO time in the client's working hours). The server holds the pending send **in memory** until then (a restart leaves a plain draft), checks again right before (no client or owner message since, the switches on, the chat not paused, P139's quiet hours) and sends through the door with the `autopilot` authority, reason `nudge`. Caps for ban risk: one nudge per chat a day, three in a row without a client message (the fourth stays a draft), and autopilot's account and chat budgets. `dry_run` leaves "Autopilot would send".

## Budgets and failure

At most 30 client turns per sweep (the rest roll to tomorrow, oldest date first), at most 60 sweep turns a day on the Mac (separate from autopilot's 100), and one of the pool's two slots, a waiting autopilot turn always first. A failed turn (timeout, `mcp_not_ready`, sign-in) keeps the client's date for the next run; three failures in a row stop the sweep with an Overview item "Follow-ups stopped: <reason>".

## Where the owner sees it

- **Overview**, per project: "Follow-ups today: N ready · M waiting · K stopped · H for you", the last and next sweep, **Run follow-ups now**; a handed-over client is a Needs you item.
- **Activity ▸ Follow-ups** (`?kind=follow-ups`): one row per plan (name, channel, state word, next date, reason, nudges sent) with Change date, Stop (with Undo), Resume and Open conversation. Every decision is also one Activity line ("Follow-up · Anna · nudged on WhatsApp (2nd) · next 30 Nov").
- **The conversation header** (Mail and Messengers) beside "Map · …", and a "Follow-up 30 Nov" chip on list rows.
- **Notion**: the client's Clients page gets the four Hub-owned properties `Next follow-up`, `Follow-up status`, `Follow-ups sent`, `Waiting on` (`hub install --only notion.follow-ups` adds them; the CRM's `Follow-up on` and `Waiting since` stay the CRM's) and one dated line per decision under the heading "Follow-ups", never rewritten (`packages/notion/src/follow-ups.ts`). `Next step` stays the map's: when a decision changes what is awaited the agent redraws the map's `waiting` leaf ([29-client-map.md](29-client-map.md)).

## Routes

| Route | What |
|---|---|
| `GET /api/projects/:slug/follow-ups` | the plans with their derived state and the sweep line (last, next, running, today's counts) |
| `POST /api/projects/:slug/follow-ups/sweep` | Run follow-ups now (joins a running sweep; at most 3 a day) |
| `PUT /api/projects/:slug/follow-ups/:clientId` | the owner's Change date, Stop or Resume; the exact admin Origin and `Sec-Fetch-Site: same-origin`, no ticket (they only delay or stop) |

Live topic `follow-ups` (the `follow_ups` and `follow_up_sweeps` rows); P47's enrolments are the topic `sequences`. Ops source `follow-ups`: one line per sweep and per turn, each in its action id ([28-ops-log.md](28-ops-log.md)).

## Code

`packages/config/src/follow-ups.ts` (vocabularies, limits, the brain's port), `packages/db/src/repos/follow-up*.ts` (the plan, the selector, the hooks), migration 0046, `packages/agent/src/mcp/tools/follow-ups.ts` (`follow_ups_due`, `follow_up_plan`), `apps/server/src/follow-ups/` (schedule, sweep, prefetch, nudges, routes), `packages/notion/src/follow-ups.ts`, the installer step `notion.follow-ups`, the skill `skills/follow-up-sweep`, the e2e `apps/admin/e2e/z-follow-ups.spec.ts` (`HUB_FOLLOWUP_BRAIN=fake`, refused without a throwaway `HUB_DB`).

P47 sequences coexist ([23-sequences.md](23-sequences.md)): a client with an open enrolment belongs to the sequence and is not swept. Whether to retire enrolments into the plans is a question for P47's W4 report.

Update this page when the architecture changes.
