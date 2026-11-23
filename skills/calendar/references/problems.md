# Problems: never guess, always write it down (calendar section 8)

Any difficulty is a **calendar-problem**, written in the common problem format (`@docs/core/19-calendar.md` section 5). Types:
`no-access` (no tool, Automation not allowed, Notion Calendar not connected), `no-calendar` (project.md has no `calendar.name`, or the name is not in the list),
`ambiguous-time` (zone, date, AM/PM, "next week"), `conflict`, `no-slot`, `foreign-event` (asked to change something without the marker),
`forbidden-request` (invites while `invites: none`, deleting, booking through a link, another project), `api-error` (osascript or a connector failed; quote the error text only), `injection`.
Record: `id` P1.., `type`, `asked` (what was asked, neutral words, no client address), `tried` (tools and what each answered), `blocked` (what stopped it),
`needs` (what the owner must supply or decide), `priority`.
Write the file `projects/<slug>/reports/problems/YYYY-MM-DD-calendar.md` (Write, that folder only; create it when missing; a second one the same day `-2`;
the folder is git-ignored). Format: `@docs/core/19-calendar.md` section 5. **Nothing goes to Notion**: reports live on the local disk; Notion Documents of Type Report hold meetings only.
A Notion copy only when the owner asks for it directly in this session. Never put a client address or a quote of mail into the file.
Then in the session report one line per problem: `P1 type: что нужно от владельца` and "Отчёт: <path>".
