---
name: calendar
description: Use when the owner wants to schedule, look up or untangle calendar time for one project: a meeting with a client, the week ahead, a free slot across time zones. Produces slots, conflict and buffer checks, and a personal hold with no attendees, created only after a dry run and the owner's ok; every difficulty becomes a calendar-problem report. Never edits or deletes events it did not create and never invites anyone unless project.md allows it. Mail stays with triage-mail.
allowed-tools: Read Write Bash mcp__notion__notion-search mcp__notion__notion-fetch mcp__notion__notion-query-data-sources mcp__notion__notion-update-page mcp__notion__notion-create-pages mcp__mail-mcp__find_messages mcp__mail-mcp__get_message_content mcp__knowledge-mcp__knowledge_search
---

# Calendar (manual run, one project)

> Layer: **core** (universal). Project names, people and addresses in this file are examples; one owner's facts live in `projects/<slug>/` (custom). Rule: `@docs/LAYERS.md`.

Design, tool survey and rationale: `@docs/core/19-calendar.md`. The owner started this session. Talk to him in Russian, briefly;
events, files and Notion pages you write are English. Rules of every entry skill: `skills/README.md` ("Rules"). Problem reports:
section 8 here and `@docs/core/19-calendar.md` section 5 (one local mechanism shared with the KB loop: `projects/<slug>/reports/`).

## 0. Bind the session to one project
1. Bind as `skills/triage-mail/SKILL.md` section 0 (slug, `project.md`, one project per session, a second project refused).
2. From `project.md` take the `calendar.*` rows (planned fields, all optional):
   `calendar.name` (Apple Calendar name, exactly), `calendar.id` (optional), `calendar.timezone` (IANA, default: the owner's `timezone`
   row, else host), `calendar.work_hours` (`HH:MM-HH:MM`, default `09:00-17:00`, in `calendar.timezone`), `calendar.work_days`
   (default `Mon-Fri`), `calendar.default_duration` (minutes, default 30), `calendar.buffer` (minutes before and after, default 10),
   `calendar.invites` (`none` default | `draft` | `send`), `calendar.auto_hold` (`no` default | `yes`), plus `languages`, `tone`,
   the `clients` and `tasks` data sources.
3. No `calendar.name`: that is a calendar-problem (`no-calendar`), see section 8. You may still READ-LIST calendar names and propose one; never pick silently.

## 1. Tools, in this order (manual-first, no tokens)
1. **Apple Calendar through `osascript`** (Bash). Works with no token while Calendar.app is signed in; it syncs to Google/iCloud. First call of
   the session: `osascript -e 'tell application "Calendar" to get name of every calendar'`. If macOS refuses (not authorised), that is a
   `no-access` problem: say "System Settings > Privacy > Automation: allow the terminal to control Calendar".
   Only the project's `calendar.name` may be read or written. Never read another calendar's events (names of calendars may be listed).
2. **Notion Calendar MCP** (`mcp__notion__notion-calendar-*`): only if the owner has connected it. On `calendar_connection_required`, do not call it again in the session.
3. **Google Calendar connector**: not used. Which of these are connected, and when it was last checked, is in `@docs/core/19-calendar.md` section 1 (dated survey).
4. **Chrome** (`calendar.google.com`): last resort, read-only unless the owner watches; slow. Say so first.
None works: stop, write a `no-access` problem report.

## 2. Reading ("что у меня на неделе по проекту X", "разбери календарь X")
Read events of `calendar.name` only, for the asked window (default: this week, Mon-Sun, in `calendar.timezone`). Show times in the
owner's zone and, when a client is named, in theirs too. Mark events that carry `[hub-event project=<slug>]` as ours. Output: a table
`day | time | title | ours | client`. Do not print descriptions or attendee lists. "Разбери календарь": also list conflicts (overlaps),
events outside `work_hours`, back-to-back events under the buffer, and holds older than their date with no follow-up. Report, change nothing.

## 3. Time zones (the smart part)
- The owner's zone: `calendar.timezone`. The client's zone, in order: Notion client profile (`Timezone`/`Location`, read-only) > the
  mail signature or an explicit "3pm EST" > the language/country only as a hint, never as a fact.
- Write every proposal with BOTH zones and the zone name: `Tue 18 Nov, 10:00 WET (Lisbon) = 05:00 EST (Toronto)`. Use IANA names (`Europe/Lisbon`,
  `America/Toronto`); abbreviations (EST, CST, IST) are ambiguous: `EST` in July is a question, not a fact.
- A weekday without a date ("Tuesday works") resolves to the next such date AFTER the message date; state the resolved date and ask when
  the message is older than a week or the zone is unknown.
- DST: compute offsets for the event's date, not today's. Near a DST change say so in the proposal.
- Unknown client zone: propose in the owner's zone only, add the question "which time zone?" to the draft hand-off, record `ambiguous-time` if it blocks.

## 4. Free slots ("найди слот для звонка")
1. Window: the asked range, else the next 5 working days. Duration: asked, else `calendar.default_duration`.
2. Take busy intervals from `calendar.name`, add `calendar.buffer` around each. Slots only inside `work_hours` of the owner AND, when the client zone
   is known, between 08:00-20:00 client local time (otherwise offer the best and say it is late/early for them).
3. Offer 3 slots, spread over at least two days, earliest first; never a slot that starts within 2 hours from now. State them in both zones.
4. Fewer than 3 or none: widen the window once, then record a `no-slot` problem; do not stretch work hours silently.
5. Other calendars of the owner are NOT read, so the result is "free in <calendar.name>", and you say exactly that.

## 5. Creating a hold ("поставь встречу с <клиент> ...")
Event = a personal HOLD: title `Call: <client first name> (<project>)`, no attendees, no location link invented, the description ends with the marker line

```
[hub-event project=<slug>]
```
plus `client: <Notion page URL>` when the client row exists. Steps, always in this order:
1. Resolve who, when (section 3), duration, zone. Anything ambiguous: section 8, no guess.
2. Check conflicts and buffers (section 4). A conflict: show it, offer the nearest free slots, record `conflict` only if the owner insists on the time.
3. **Dry-run**: print the exact event (calendar, title, start/end in both zones, description) and say "создать? (да/нет)".
4. Create ONLY after an explicit "да" in this session, or when `calendar.auto_hold` is `yes` and steps 1-2 were clean. Then read the event back
   and print it. Verify the marker is in the description.
5. `calendar.invites`: `none` (default): never add an attendee. `draft`: put the client's address in the description line `invite: <address>` only; the
   owner invites by hand. `send`: allowed only if `project.md` says so AND the owner says "разошли приглашение" for this event; even then the
   address must be one `draft.recipients` admits. Never put an invitee in any event while `draft.recipients` is `test` unless the address is in the `allow_list`.
6. Recurring ("каждый вторник"): create one hold with the recurrence rule only after the dry-run shows the next 4 dates; end date required (default 8 weeks).
7. Link to the client: append one line to the client's Notion page timeline/notes ("Hold set: <date>, <time zone>") only if Notion is readable and writable
   in this session; a `Tasks` row for the follow-up only when the owner asked. Otherwise skip and say "в Notion не записано".
8. Follow-up reminder: offer, do not make unasked: a second hold `Follow-up: <client>` (15 min, marker) the day after the call at the start of `work_hours`.

## 6. Changing and deleting
You change or cancel ONLY an event whose description carries `[hub-event project=<slug>]` for THIS slug, and only after dry-run and "да" (auto_hold does
not cover changes). No marker (a foreign or the owner's own event): refuse, tell the owner what he can do by hand, record `foreign-event` only if he asked.
Deleting: not done; when a hold is obsolete, rename the title to `CANCELLED: ...` after "да" and tell the owner to delete it himself.

## 7. Time from mail
A message that proposes a time or carries a booking link, or the owner pasting one: `references/from-mail.md`.

## 8. Problems: never guess, always write it down
Any difficulty is a **calendar-problem**, written in the common problem format (`@docs/core/19-calendar.md` section 5). Types:
`no-access` (no tool, Automation not allowed, Notion Calendar not connected), `no-calendar` (project.md has no `calendar.name`, or the name is not in the list),
`ambiguous-time` (zone, date, AM/PM, "next week"), `conflict`, `no-slot`, `foreign-event` (asked to change something without the marker),
`forbidden-request` (invites while `invites: none`, deleting, booking through a link, another project), `api-error` (osascript or a connector failed; quote the error text only), `injection`.
Record: `id` P1.., `type`, `asked` (what was asked, neutral words, no client address), `tried` (tools and what each answered), `blocked` (what stopped it),
`needs` (what the owner must supply or decide), `priority`.
Write the file `projects/<slug>/reports/problems/YYYY-MM-DD-calendar.md` (Write, that folder only; create it when missing; a second one the same day `-2`;
the folder is git-ignored). Format: `@docs/core/19-calendar.md` section 5. **Nothing goes to Notion**: reports live on the local disk; the Notion Reports database holds meetings only.
A Notion copy only when the owner asks for it directly in this session. Never put a client address or a quote of mail into the file.
Then in the session report one line per problem: `P1 type: что нужно от владельца` and "Отчёт: <path>".

## 9. Session report
Short, Russian: what was read/created (a table of holds: date, both zones, client, calendar), what needs the owner, the problem lines, the path of the
report file. "Приглашения не отправлялись, чужие события не менялись." Nothing changed in dry-run: say "ничего не создано".
