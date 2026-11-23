# Follow-up sequences (admin label "Follow-ups")

Layer: **core** (the engine). The sequences themselves are a project's own files (custom). Rule: `@docs/LAYERS.md`.

A sequence is a short, written plan of follow-ups for one kind of silence: "we answered an enquiry and they did not write back", "we sent a proposal and heard nothing". A client is enrolled when the owner says so: in a session, by a phrase naming clients or a segment, or in his own terminal; on the day a step falls due, a session drafts that step into Mail when the owner asks; the owner sends it from Mail. A reply, a bounce, an opt-out, a closed lead or a do-not-contact mark ends it.

**Manual-first.** Nothing runs on a timer. There is no scheduler and no automatic send: the hub only says what is due. A session enrols only on the owner's words in that session, and they are stored with the enrolment; it never enrols on its own initiative. Pause and resume are the owner's. Otherwise the agent can only reduce mail: stop, delay, judge.

## The file

`projects/<slug>/sequences/<id>.md`, one file per sequence, versioned with the instance. Parser: `app/packages/sequences/src/definition.ts`.

| Front matter | Values |
| --- | --- |
| `name` | unique in the project |
| `description` | starts "Use when ..." |
| `status` | `Draft`, `Active`, `Retired`. Draft and Active can be enrolled (an Active one is offered first); Retired never |
| `applies_to` | JSON list: `Lead`, `Client` |
| `mail_classes` | JSON list of the project kind's mail classes the sequence fits (empty: any) |
| `languages` | JSON list, for the opt-out line |
| `business_days` | `true` (default): waits skip Saturday and Sunday |
| `enrol_after_days` | how long our message must be unanswered before the client is offered (default 2) |
| `max_words` | the most words a step draft may have, 30 to 400 (default 90); `sequence-drafts` keeps every step under it |
| `stop_on` | optional extra stop reasons (`out_of_office`). The core's five always apply; a file can add one, never remove one |

Sections: `Goal`, `Steps` (a table: `#`, `after (days)`, `purpose`, `adds`, `knowledge topics`), `Last step`, `Do not`, `Opt-out line`. `after (days)` counts from **our previous message**, so a timeline of +2, +5 and +9 days is written 2, 3, 4. A wait is a whole number from 1 to 60. `hub sequences check <slug>` (and the doctor row "sequences parse") names every fault by row.

## The state

One SQLite table, `enrollments` (migration 0016): project, client, sequence id, the file's hash, a copy of the waits taken at enrolment (`schedule`), step, state, next due date, anchor (our message the step follows), who enrolled (`owner`, or `agent` for a session) with the owner's phrase that asked for it (`enrolled_phrase`, null when he enrolled in his terminal), and the finish. One open enrollment per client (a partial unique index). A step draft carries `enrollment_id` and `sequence_step`.

| State | Means |
| --- | --- |
| `active` | waiting for its date, due, or a step draft is open |
| `paused` | the owner paused it; nothing falls due |
| `finished` | with a reason: `replied`, `bounced`, `opted_out`, `closed`, `excluded`, `completed`, `stopped` |

What the admin shows (waiting, due, draft ready) is derived from those, never stored. Transitions are one table, `app/packages/sequences/src/transitions.ts`, tested case by case.

- **A reply stops it.** Any record of the client by another skill (`triage-mail`, `bulk-drafts`, `hub record-client`) finishes the open enrollment as `replied`, except a record carrying the owner's words (`ownerRequest`, P85: a message on his initiative is not the client writing), and skips the open step draft in the same write. Crossed off: `excluded`. The do-not-contact mark: `opted_out`. A message dated at or before our anchor is not a reply.
- **A step moves it.** A step draft that becomes done, skipped or sent advances the enrollment once (sent: Sent detection finds it in the project's Sent mailbox in Apple Mail, which needs Mail running; otherwise the owner's Done moves it, decision 0026); Undo or Reopen moves it back. The last step finishes it as `completed`.
- **Not now** writes a finished row for this silence, so the client is not offered again until we write again.

## Who may do what

| Move | Owner | Agent session |
| --- | --- | --- |
| Enrol | yes, in his terminal (`hub sequences enrol`), or by saying so in a session | only on the owner's phrase in that session: `--phrase "<his words>"` is required and stored (`enrolledBy: agent`); without it the CLI refuses (it sees `CLAUDECODE` or `HUB_PROJECT`) and the guard flags the call. Never on its own initiative |
| Not now, pause, resume | yes, in his terminal | no: denied (`Bash(*sequences pause*)`, `Bash(*sequences resume*)`), flagged by the guard, and the CLI refuses in a session |
| Stop, delay, judge | yes | yes (they only reduce mail) |
| Draft a due step | no (it asks a session) | yes, `sequence-drafts` |
| Send a step | from Mail | never: `hub send` and the admin's Send refuse any draft with `enrollment_id`, in every send mode |

## Commands

- `hub sequences list <slug>` and `check <slug>`: the files and their faults.
- `hub sequences due <slug> --json`: what a session reads (the step's row, our message to reply to, the opt-out line, whether the file changed since enrolment).
- `hub sequences candidates <slug>`: the quiet clients (our message is the newest and old enough, nothing open, no do-not-contact).
- `hub sequences enrol <slug> --client <email> [--sequence <id>] [--phrase "<words>"]`: the owner in his terminal; a session only with `--phrase`. `pause` and `resume`: owner only. `stop --reason`, `delay --until`, `judge` (the facts a session read, as JSON on stdin, through the stop rule of `app/packages/sequences/src/stops.ts`).

## The admin

Mail has a **Follow-ups** view in its View menu (`?filter=sequences`: the open step drafts; the one control is **Stop follow-ups**; its empty state gives the phrase to say to the agent). The admin has no Enrol control: enrolling is a phrase in a session (decision 0025). A step draft's card is state 17, `follow_up`: Open the draft in Mail is its one primary, the badge says "Follow-up N of M", and **Stop follow-ups** is in its header. The admin reads all of it through `/api/projects/:slug/sequences` and `/enrollments`; it never imports `@hub/sequences` (eslint).

## In a session

`skills/sequence-drafts/SKILL.md`: when the owner's words name clients or a segment, enrol exactly those with `--phrase`; then read the due rows, re-check each client (reply, bounce, opt-out, out-of-office, profile marks) through `judge`, then one unsent `draft_write` (hub MCP) per step that may still go, recorded with the `sequence` block. No Notion write. `triage-mail` reports "follow-ups stopped: replied" when its record ended one.

## Starter pack

`app/projects/_template/sequences/` holds two generic sequences, both Draft: `answered-enquiry-no-reply.md` and `proposal-sent-no-reply.md`. `project-setup` copies the folder (`cp -R`); the copy is the project's own.

Update this page when the architecture changes.
