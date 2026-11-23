# Time zones and free slots (calendar sections 3 and 4)

##  Time zones (the smart part)
- The owner's zone: `calendar.timezone`. The client's zone, in order: Notion client profile (`Timezone`/`Location`, read-only) > the
  mail signature or an explicit "3pm EST" > the language/country only as a hint, never as a fact.
- Write every proposal with BOTH zones and the zone name: `Tue 18 Nov, 10:00 WET (Lisbon) = 05:00 EST (Toronto)`. Use IANA names (`Europe/Lisbon`,
  `America/Toronto`); abbreviations (EST, CST, IST) are ambiguous: `EST` in July is a question, not a fact.
- A weekday without a date ("Tuesday works") resolves to the next such date AFTER the message date; state the resolved date and ask when
  the message is older than a week or the zone is unknown.
- DST: compute offsets for the event's date, not today's. Near a DST change say so in the proposal.
- Unknown client zone: propose in the owner's zone only, add the question "which time zone?" to the draft hand-off, record `ambiguous-time` if it blocks.

##  Free slots ("найди слот для звонка")
1. Window: the asked range, else the next 5 working days. Duration: asked, else `calendar.default_duration`.
2. Take busy intervals from the project's calendar (`suggest_time` of the connector may propose them), add `calendar.buffer` around each. Slots only inside `work_hours` of the owner AND, when the client zone
   is known, between 08:00-20:00 client local time (otherwise offer the best and say it is late/early for them).
3. Offer 3 slots, spread over at least two days, earliest first; never a slot that starts within 2 hours from now. State them in both zones.
4. Fewer than 3 or none: widen the window once, then record a `no-slot` problem; do not stretch work hours silently.
5. Other calendars of the owner are NOT read, so the result is "free in <the project's calendar>", and you say exactly that.
