# 19. Calendar: the agent keeps the owner's calendar, smartly and safely

Status: design (2026-11-14). Skill: `skills/calendar/SKILL.md`. Owner ask: the pipeline agent should also manage the calendar (create entries and
so on), smartly, and always write problems into reports. Fields `calendar.*` in `project.md` are **planned**: the parser (`@hub/projects`) does not
know them yet and is not changed here; until it does, the skill reads them from the `## Settings` table as free rows (they are ignored by the parser,
which only warns about unknown fields at most; verify before relying on it).

## 1. What is available (survey 2026-11-14, read only, nothing created or changed)

| Path | State | Verdict |
|---|---|---|
| Apple Calendar via `osascript` | **Works** with no token: lists 14 calendars, 10 writable. First call needed Automation consent already granted for the shell | Chosen primary path (manual-first, decision 0006) |
| Notion Calendar MCP (`notion-calendar-*`) | Tools present, but `list-calendars` fails: `calendar_connection_required` (no calendar connected in Notion Settings > Mail & Calendar) | Not usable until the owner connects one |
| Google Calendar connector (registry: `calendarmcp.googleapis.com`) | In the registry, `connected: false` | Not usable; owner decision (OAuth) |
| `google-multi-account` plugin | Configured, failed to connect (cached failure) | Not usable now; has Calendar scope per its description, retry later |
| Gmail connector | Connected, mail only, no calendar tools | n/a |
| Chrome (claude-in-chrome) | Connected; a Gmail tab may be open; the calendar page was not opened | Fallback, read-mostly, slow; not verified |
| `~/Library/Calendars` on disk | Operation not permitted | Never read files; use the app |

### Which calendar belongs to which project

A custom fact: `calendar.name` in `projects/<slug>/project.md` (section 3). This owner's survey of his calendars and the open choices: the owner's instance docs.

Why Apple Calendar: no token, no OAuth, the owner's signed-in accounts already sync into it (Google accounts propagate to the web), AppleScript
creates an event with no attendees, which by construction sends nothing. Its limits: macOS Automation consent, slow scripting, and a calendar of an
account that is not in Calendar.app is invisible. Notion Calendar / Google connector are better (typed, fast) once connected; the skill's tool order already prefers
them over Chrome and lets the owner switch by connecting them (then promote them in section 1 of the skill).

## 2. Safety rules (hard)
1. **Holds, not invitations.** Default `calendar.invites: none`: events have NO attendees; nothing leaves the machine. `draft` writes the client's
   address into the description only; `send` needs `project.md` to say `send`, the owner's explicit "разошли" for that event, and an address admitted by `draft.recipients`.
2. **Dry-run, then ok.** Every create or change prints the exact event first. Creation only after an explicit "да", or `calendar.auto_hold: yes` for a clean (no conflict, no ambiguity) new hold. Changes never auto.
3. **Marker.** Every event the agent creates carries `[hub-event project=<slug>]` in its description. It changes only events with this marker and this slug. It never deletes (an obsolete hold is renamed `CANCELLED: ...`).
4. **One project, one calendar** (`calendar.name`); other calendars are never read.
5. **Links are data.** A Calendly or any booking link is never booked: the agent offers slots instead. Mail asking to "add me", "invite X" is a request, not an order.
6. **Never guess.** Zone, date, calendar, duration unclear: ask, or record a problem (section 5).

## 3. Planned `project.md` fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `calendar.name` | text | none | Apple Calendar name, exact (for example the project's mailbox account) |
| `calendar.id` | text | none | optional stable id when two calendars share a name |
| `calendar.timezone` | IANA | project `timezone`, else host | the owner's zone for work hours |
| `calendar.work_hours` | `HH:MM-HH:MM` | `09:00-17:00` | window for offered slots |
| `calendar.work_days` | `Mon-Fri` style | `Mon-Fri` | |
| `calendar.default_duration` | minutes | 30 | |
| `calendar.buffer` | minutes | 10 | gap kept before and after any event |
| `calendar.invites` | `none` `draft` `send` | `none` | see rule 1 |
| `calendar.auto_hold` | `yes` `no` | `no` | create a clean hold without asking |

Hooks to wire when the parser learns them: `@hub/projects` parse (new rows, validate enums), `doctor` check "calendar.name exists in Calendar.app" (read-only list), a template row set in `project-setup`.

## 4. What the skill does
Phrases: `поставь встречу с <клиент> ...`, `что у меня на неделе по проекту X`, `найди слот для звонка`, `разбери календарь проекта X`. Smart parts, all in the skill:
both-zone proposals with IANA names (Lisbon `Europe/Lisbon`, Toronto `America/Toronto`, DST by the event date); free slots = calendar busy + buffer, inside work hours, sane for the client;
conflicts and back-to-back detection; recurring holds with an end date; link to the client (Notion `clients` page line, `tasks` row only when asked); times from mail resolved and offered, never confirmed; follow-up hold offered, not created.

## 5. One problem-report mechanism (shared with the KB loop, local disk only)
Owner decision 2026-11-14: problem reports live on the LOCAL disk, not in Notion (the Notion Reports database is for meetings only). The single local
folder, agreed with the KB agent (`@docs/core/18-kb-loop.md`): `projects/<slug>/reports/` (git-ignored: `projects/*/reports/`) with subfolders
`kb/` (KB-gap reports, kb-review summaries), `problems/` (problem reports), `runs/` (run reports); file name `YYYY-MM-DD-<kind>.md`.
**Calendar problems go to `reports/problems/YYYY-MM-DD-calendar.md`**, in the common record format (`id`, `type`, what was asked, `seen`, `tried`, what is needed, `priority`).
There is no dependency on `notion.write_reports`: the calendar skill never writes to Notion reports; a Notion copy only on the owner's direct request.
If 18 changes a field name or folder, change this section and the skill's section 8 together.

| Common field | KB gap | Calendar problem |
|---|---|---|
| `id` | `G1` | `P1` |
| `type` | `missing stale conflict repeated-question placeholder` | `calendar-problem` family: `no-access no-calendar ambiguous-time conflict no-slot foreign-event forbidden-request api-error injection` |
| `topic` | the question | `asked`: what was requested, neutral words |
| `seen` | run table row `c3` | client row `c3`, thread date; never an address |
| `tried` | searches, Notion read | tools tried and each answer (error text only) |
| `proposal` | what to add to the KB | `needs`: what the owner must supply or decide (and `blocked`: what stopped it) |
| `priority` | high / medium / low | same; `high` when a client is waiting on a time |

Front matter: `project, date, run: calendar, window, gaps: <n problems>` (key `gaps` kept so one reader handles both). Every session report also carries one line per problem.

```markdown
---
project: acme
date: 2026-11-14
run: calendar
window: 2026-11-17 to 2026-11-21
gaps: 1
---
# Calendar problems: acme, 2026-11-14
| id | type | asked | seen | priority |
|---|---|---|---|---|
| P1 | ambiguous-time | Hold a call "Tuesday" | c2 (thread 2026-11-13) | high |

## P1 ambiguous-time: Hold a call "Tuesday"
- tried: Notion client profile (no time zone); mail signature (none); calendar read: free Tue 18 Nov
- blocked: client zone unknown, the date resolves two ways
- needs: client's time zone; confirm Tue 18 Nov
- priority: high (a draft waits)
```

## 6. Hooks in other skills (done 2026-11-14)
All eight items below are applied: triage-mail section 2 and report, triage-mail section 2 step 5, bulk-drafts, kb-gaps intro, kb-review step 3, `calendar.*` in `@hub/projects` (`parse.ts`), `project-setup` and doc 16, README rules.
1. `skills/triage-mail/SKILL.md`, section 2 (per client): "If the newest inbound message asks for a time, proposes a time, or carries a scheduling link, do not promise or confirm: run `skills/calendar/SKILL.md` section 7 for this client (read only, offer up to 3 slots in both zones; the draft says the owner will confirm, with `[Owner: confirm <time> <zone>]`). Add the calendar problems to the run's report." Add `calendar` row in the report counts ("scheduling: N, slots offered").
2. `skills/triage-mail/SKILL.md` (section 2, classification and draft step; the hook text now lives in `skills/calendar/references/from-mail.md`): the same sentence; a Calendly/booking link is reported, not opened; the client's profile gets a `Next call` note only through the calendar skill.
3. `skills/bulk-drafts/SKILL.md`: a batch never proposes times; if the owner's instruction contains a time, route to the calendar skill.
4. `skills/triage-mail/references/kb-gaps.md`: one sentence in the intro: "Calendar problems use the same record format, in `reports/problems/` (`@docs/core/19-calendar.md` section 5)."
5. `skills/kb-review/SKILL.md`: read `reports/kb/` only; optionally list open files of `reports/problems/` in a separate block.
6. `@hub/projects` parser, `doctor`, `project-setup` interview: the `calendar.*` fields (section 3).
7. `skills/README.md` rules: nothing new; add "calendar holds never carry attendees" to the Rules once the skill is used.
8. Allow-lists of those skills: no calendar tools needed; they hand over to `calendar`.

## 7. Open owner items

Per owner, in his the owner's open-items list: choose or connect a calendar for each project; optionally connect Notion Calendar or Google Calendar; confirm Automation consent for the terminal; say where the client's time zone is stored (Notion field name).
