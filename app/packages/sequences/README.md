# @hub/sequences

Follow-up sequences (P47): the rules of a client who does not answer. The design and the commands are the core page
`@docs/core/23-sequences.md`; this package is the one place the rules live, so the database, the CLI and the server use one rule.

- `src/definition.ts`: `parseSequence(text, file)` over the text of `projects/<slug>/sequences/<id>.md` (front matter, the
  Steps table, the stop list; every problem is an issue, never a throw), `isUsable`, `pickSequence`, `scheduleOf`.
- `src/transitions.ts`: `enrolSnapshot` and `transition(snapshot, event)`, the one owner of an enrollment's moves. The
  repository (`@hub/db` `repos/enrollments.ts`) calls it inside its transaction and never writes a state by hand.
- `src/due.ts`: business days (Monday to Friday, the machine's local date; no holidays, no client time zone), `isDue`,
  `displayStateOf` (`waiting`, `due`, `draft_ready` are derived, never stored).
- `src/stops.ts`: `decideStop(facts, definition, anchor)`, the stop order over what a session observed (`hub sequences judge`).
- `src/load.ts`: the only `node:fs` file; `loadSequences(projectFolder)` with a sha256 per file.

Depends only on `@hub/config` (the vocabularies `ENROLLMENT_STATES`, `FINISH_REASONS`, `STOP_REASONS`). The admin never imports
it (eslint `no-restricted-imports`): it reads the API. Nothing here sends mail, runs on a timer or writes Notion.

Tests: `pnpm test` (golden definition files in `test/fixtures/`, an exhaustive transition table, weekends, out-of-office, completion).

Update this page when the architecture changes.
