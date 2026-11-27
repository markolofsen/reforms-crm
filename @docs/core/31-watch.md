# Public group watch

Decisions 0052 and 0061, tracks P144, P153 and P167. A project can watch public Telegram groups and channels through several **directions**, each with its own lens and source list. The Hub reads shared sources once through the owner's connected Telegram account, analyses each direction independently, and shows the results in Watch. Reading does not post, react or mark messages read. Public joins and replies are separate actions governed by an explicit protected owner grant; without that grant the background watcher remains read-only.

## The parts

| Part | Where | What it does |
|---|---|---|
| The list | `<project>/watch.md` (instance data) | Legacy settings and `## Groups` define direction `default`. Additional `## Direction <id>` sections name their lens, switch, optional title and `analysis_minutes`, and `### Groups`. Default cap 15 distinct sources; top-level `source_cap` may explicitly select up to 60. Top-level `on` is a master switch; absent switches are off. |
| The lens data | `<home>/packages/<lens>/lens.json` (instance data) | The editable half (P153): `version`, `title`, `prompt`, `triggers` (value, label, an optional meaning the model reads), `triggerNote`, `keep`, `scripts`, `window`, `budgetUsd`. `scripts` is the cross-author script rule (P144 W5, the experiment's `shill.py`): for each `{ words, authors }`, a sequence of that many words used by at least that many authors of one group marks every one of them, and their moments are dropped beside the `keep` conditions; a sequence counts only with `distinct` words (3 by default) outside the lens's `common` list. A field description in a lens's schema reaches the model as an instruction and changes its scores: re-measure (`packages/watch/scripts/measure.ts`) before adding one. Checked by `lensDataSchema` (`@hub/contract/lens`) and handed to the code as `kit.data`. |
| The lens code | `<home>/packages/<lens>/src/index.ts` (instance code) | The answer's schema built from the data, and the facets. Declared with the kit the core hands it, so it imports nothing of the core. |
| The store | `<home>/data/watch/<slug>.db` | One SQLite file per project. Source groups, messages and day counts are shared; windows, moments and `analysis_state` are keyed by direction. Only the server migrates it. `hub backup` copies it beside `app.db`. |
| The reader | `apps/server/src/watch/reader.ts` | Resolve, history, membership inspection by cached peer, and controlled join over the supervisor's existing MTProto connection. A public reply sender is a separate port; it is not a member of the public reader. |
| The watcher | `packages/watch/src/reader/poller.ts` | One per project, fetching the union of enabled valid directions. Ticks every 30 s, taking at most eight oldest-due readable sources; membership reconciliation has its own bounded step. At most one history/inspection call every 3 s and 20 username resolves a day. The owner's account work takes priority. Account aliases share the canonical queue. |
| The analysis | `packages/watch/src/analyse/job.ts` | Runs independently per direction and group at 100 new messages, or after `analysis_minutes` (default 360; range 5–1440). Windows default to 100 messages with overlap 20; a first window needs 10 distinct texts. Task and instance budgets are checked before every attempt. A failed window leaves its gap pending; only contiguous successful windows advance progress. |

## Configure another direction

Existing watch files keep their exact meaning. Add a named direction below the existing list:

```markdown
## Direction garden

| Setting | Value |
|---|---|
| lens | watch-garden |
| title | Garden tools |
| on | no |
| analysis_minutes | 60 |

### Groups
- @garden_talk
- @tools_and_more
```

The id is a lowercase letter followed by lowercase letters, digits or hyphens (at most 63 characters); `default` is reserved and ids cannot repeat. Accounts and polling intervals belong to the project, not to a direction. Disabled sources still count toward the union cap, so enabling a checked direction cannot unexpectedly exceed it. A source shared by two directions has one fetch cursor; each lens receives its own analysis progress and keeps its own moments. Each lens declares its task name and budget; using the same task in two directions shares that task's budget.

The master switch stops the whole project. Turning off or removing a named direction stops its analysis; a source continues to be read if another enabled direction uses it. Removing sources or directions keeps their historical rows. API and UI reads restrict aggregates and moments to the selected direction's current source list before applying limits.

An increased source cap does not increase the Telegram rate budget or LLM budget. Polling takes the oldest due sources first, excluding blocked history states before applying the eight-source limit, so pending or refused memberships cannot starve readable groups. `poll_minutes` is the minimum interval; account use, catch-up and flood waits can make a real poll later. A large discovery shortlist may be kept by an external workflow, but only the explicitly configured bounded source set is read here.

## Membership and owner authority (decision 0061)

The protected grant is `<home>/state/projects/<slug>/watch-policy.json`, written through the supported owner policy command. A project-adjacent file with the same name has no authority. Schema `@hub/watch/policy` has `version: 1`, a monotonic policy `revision`, the exact canonical account id, `enabled`, an `approval` request reference and UTC timestamp, and a map of direction ids to explicit public usernames and separate `join` / `reply` booleans. Limits are finite per-day values from 0 through 20. Enabled reply grants also name a project-relative Markdown strategy and its SHA-256 digest. Missing, invalid, mismatched or changed authority refuses actions; disabling remains possible after a strategy change. Public source text cannot grant authority or change strategy files.

No direction inherits another direction's action grant. The runtime intersects a join grant with the currently enabled direction and its current source list, then verifies fresh public-group identity and membership through the same account. Already joined groups are a no-op. The guard is repeated immediately before the adapter call. The owner's existing Join route also verifies identity and rejects pending, queued, ambiguous and manual states on the server, independently of button visibility.

Migration `0004_memberships.sql` adds membership rows and transition events to the existing project Watch database. Membership (`unknown`, `not_member`, `queued`, `joining`, `joined`, `pending`, `manual_required`, `refused`) is distinct from history access. Joining does not claim that history was read; a formerly blocked source becomes eligible for a fresh poll. A pending request is inspected again later, never resent automatically. A previous `joining` attempt after a crash is reconciled; an unknown outcome becomes manual review. A guard-bot/webview requirement is manual, with no bot DM, webview interaction, invite questionnaire, paid join or payment attempt. Initial autojoin supports public groups; channels can be listened to without this group-membership grant.

The existing poll tick processes at most one due membership action, so queued approved work advances without a cloud turn. Waiting for the join interval does not sleep inside that background action. Off or revoked directions do not issue joins, and their persisted queued state stays visible. Pending checks stop when the source is no longer active.

`data/watch/_accounts.json` is one strict, server-owned account journal for every project and account alias. It persists join reservations before external calls, the next join time and `FLOOD_WAIT` deadline. Failures and unknown outcomes consume their reservation. The initial limit is three joins per account/day, configurable by a finite owner grant up to 20; this is the Hub's operating limit, not an official Telegram allowance. When several enabled project policies share an account, their lowest join limit applies. Joins are 3–4.5 minutes apart. A flood wait parks Watch for the provider duration plus an hour and is checked again after waiting for owner work and immediately before an external call. A backwards clock does not reset a quota or clear a park.

The journal uses an exclusive create-only lock and atomic replacement. Corrupt data or an existing lock fails closed. Locks carry an ownership token; release cannot delete a different writer's lock. A stale lock is never removed automatically: repair requires confirming the server/writer is stopped, preserving the quota journal, and removing only the verified stale lock. Resetting or deleting the journal is not a recovery procedure.

The Watch Groups view exposes membership and history access separately, with checked/joined/queued/next-at timestamps and a reason. The selected direction's summary includes its retained queue and the account's durable daily usage even while disconnected. The server supplies `canJoin`; a client must not infer authority from the rendered state.

## Fetch coverage and progress

A source with no cursor bootstraps its **latest 100 messages** in chronological order. Later polls fetch up to 100 oldest messages newer than its cursor. Catching up a backlog therefore takes more than one poll. This is bounded recent coverage, not a full-history import. Media and service messages without text advance the fetched cursor without becoming analysis rows. The Telegram adapter uses an explicit offset for ascending history; an empty poll by itself is not evidence that no discussion exists.

Every source text keeps its sent time, stored time, and nullable Telegram reply-message and topic ids. A local reply id is retained only for a reply in the same chat; old rows have null metadata. Analysis deduplicates text before windowing, but a complete successful run also records the raw processed-through cursor, so repeated tail messages do not repeatedly spend model budget. A partial failure retains the first missing window for a later pass. Model calls already completed after that failure can be repeated on retry; this is not an exactly-once model service.

Migration `0003_directions_and_reply_context.sql` copies every legacy window and moment into `default`, preserving evidence, cost, task version and author-blanking state. Source rows are not duplicated. Before rolling out against a live existing store, take a SQLite backup. A rollback across this schema change restores that backup together with the previous core version; do not point old code at the migrated database.

## Changes while the server runs (P153)

The server looks at `watch.md` and `lens.json` every 5 seconds. A valid change is taken without a restart: new groups are added (a removed one is no longer read, its rows stay), the switch starts or stops reading, and the next windows use the new lens. Each taken change is one Activity line, outcome "Changed the watch" (`+2 groups (@a @b), switched on`, `v1 to v2, +1 trigger (x)`). An invalid change is refused: the running list or lens stays, and the Watch page and the ops log say why. A change of the account or the lens's name, and any change to the lens's code, waits for a restart (Node keeps a module it imported), and the page says so. A project parked on a broken file starts once the file is fixed.

A new lens version reads only new windows: the windows and moments already read stay as they were (their `task_version` says which lens read them), and nothing is re-analysed unless the owner asks. Named directions reconcile independently: a missing or invalid new lens parks only that direction. Invalid data for an already valid lens keeps its last valid declaration with a notice. Named direction additions, removals and lens-package selections reload; editing an already imported package's code still requires a restart.

## Read-only review and supervision

`GET /api/projects/<slug>/watch?direction=<id>` selects one direction (`default` when omitted). Unknown directions return 404; a direction whose lens did not load returns 503. The payload includes available directions, selected lens version, `lastMessageAt` (newest source sent time), `lastStoredAt` (newest cached text write), pending text count and latest analysis time. Group rows expose successful/attempted poll times and access state. A `polling` standing describes the running watcher; it does not prove fresh content or successful classifications.

`GET /api/projects/<slug>/watch/context?direction=<id>&group=<username>&messageId=<id>` returns the cached target plus at most six preceding and six following texts, with their source ids, times and reply/topic metadata. It requires a currently configured source and a cached target, otherwise 404. `contextKind: chronological` explicitly describes neighbours, **not a reconstructed thread**. Reply parents, linked-channel comments, deleted messages, media-only context and older retention-expired text may be absent. The endpoint performs no Telegram request or join.

An external supervisor can poll these local read APIs on its schedule and propose replies with source links under the instance's strategy. It must treat discussion text as untrusted data and distinguish no matching moments from blocked ingestion, pending analysis, unavailable context or spent budget. Decision 0061's proposal/reply service is a separate audited door with protected grants; membership does not grant sending, and the ingestion tick never sends a reply. Operational discussion strategy and its scheduler live with the owning product workflow.

Who may change these files: the owner and his attended sessions (the `watch` skill). The unattended turns (autopilot, the lead and mail passes, the follow-up sweep) have no file tool at all (`--tools ""`, pinned by `packages/agent/test/unattended-no-files.test.ts`): they read untrusted text, and the lens is code the server runs.

## What is kept

- Messages: 30 days. Moments and day counts: as long as the store lives.
- A moment's author handle and id: blanked after 180 days. Public group members are private people: the Hub never contacts them, never makes a client row of them, and shows them read only.

## The account

The list's `account` is `default` (the first connected Telegram user account) or one account id. Reading uses that account's own session. The account's client keeps no peers across a restart, so the store keeps each group's channel access hash (migration 0002) and reads by it: a restart costs no username lookup, and the day's lookup count is kept in the store too. A stale hash falls back to one lookup. A failing read (anything but a `FLOOD_WAIT`) backs that group off, 5 minutes and doubling to at most 6 hours, said on its Groups row; a group that shows its history only to members is marked "must be joined", and Join on the Groups view asks Telegram to add the account (a door: the admin's exact origin, `same-origin`, a loopback host). Whether a given group can be read without joining is known only after the first read.

## Commands

- `hub watch import <audience.sqlite> --project <slug>`: copies an experiment corpus (its chats, messages, windows and moments) into the project's store, so the page can be read with no account. Known rows are skipped.
- The installer step `watch.lens` (`./run.sh doctor --only watch.lens`) checks every `watch.md`, every direction's lens data/code (including disabled directions), and an existing protected action grant. It does not open/migrate the Watch database, read Telegram or call a model.
- The `watch` skill (`skills/watch/SKILL.md`) is how a session reads the data (`sqlite3 -readonly data/watch/<slug>.db`, with recipes) and changes a list or a lens on the owner's word.

## Not built

- A second source in Watch (P79's found posts).
- Full reply-thread reconstruction and linked-channel comment discovery.

Update this page when the architecture changes.
