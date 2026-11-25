# Public group watch

Draft decision 0052, track P144. A project can watch public Telegram groups: the Hub reads them with the owner's connected Telegram account, cuts the messages into windows, asks a model what each window says through the project's **lens**, and shows the result in the Watch section. Nothing is ever posted, reacted to, marked read or sent to a group or to anyone in it. This page is the whole mechanism.

## The parts

| Part | Where | What it does |
|---|---|---|
| The list | `<project>/watch.md` (instance data) | A settings table (`lens`, `on`, `account`, `poll_minutes`) and a `## Groups` list of at most 15 public usernames (what one account's 20 username lookups a day carry). `on` is `no` by default: a restart never starts reading by itself. |
| The lens data | `<home>/packages/<lens>/lens.json` (instance data) | The editable half (P153): `version`, `title`, `prompt`, `triggers` (value, label, an optional meaning the model reads), `triggerNote`, `keep`, `scripts`, `window`, `budgetUsd`. `scripts` is the cross-author script rule (P144 W5, the experiment's `shill.py`): for each `{ words, authors }`, a sequence of that many words used by at least that many authors of one group marks every one of them, and their moments are dropped beside the `keep` conditions; a sequence counts only with `distinct` words (3 by default) outside the lens's `common` list. A field description in a lens's schema reaches the model as an instruction and changes its scores: re-measure (`packages/watch/scripts/measure.ts`) before adding one. Checked by `lensDataSchema` (`@hub/contract/lens`) and handed to the code as `kit.data`. |
| The lens code | `<home>/packages/<lens>/src/index.ts` (instance code) | The answer's schema built from the data, and the facets. Declared with the kit the core hands it, so it imports nothing of the core. |
| The store | `<home>/data/watch/<slug>.db` | The project's own SQLite file: groups, messages, windows, moments and day counts. Its own migrations (`packages/watch/migrations`); only the server migrates it. `hub backup` copies it beside `app.db`. |
| The reader | `apps/server/src/watch/reader.ts` | Three calls only, over the account's one MTProto connection: resolve a username, read history after the last stored message, and join (only on the owner's click). No write method exists. |
| The watcher | `packages/watch/src/reader/poller.ts` | One per watch list. Ticks every 30 s and reads a group when its `poll_minutes` have passed; at most one call every 3 s, 20 resolves a day, 3 joins a run (3 to 4.5 minutes apart). Waits while the owner's own calls run. A `FLOOD_WAIT` parks the watcher for the wait plus an hour; the owner's chats are not touched. |
| The analysis | `packages/watch/src/analyse/job.ts` | Runs when a group has 100 new messages, or 6 hours after its last analysis. Windows of 100 messages with an overlap of 20 (the lens may change both); a moment repeated in the overlap is kept once. The lens task's budget is checked before every call, beside the instance cap. |

## Changes while the server runs (P153)

The server looks at `watch.md` and `lens.json` every 5 seconds. A valid change is taken without a restart: new groups are added (a removed one is no longer read, its rows stay), the switch starts or stops reading, and the next windows use the new lens. Each taken change is one Activity line, outcome "Changed the watch" (`+2 groups (@a @b), switched on`, `v1 to v2, +1 trigger (x)`). An invalid change is refused: the running list or lens stays, and the Watch page and the ops log say why. A change of the account or the lens's name, and any change to the lens's code, waits for a restart (Node keeps a module it imported), and the page says so. A project parked on a broken file starts once the file is fixed.

A new lens version reads only new windows: the windows and moments already read stay as they were (their `task_version` says which lens read them), and nothing is re-analysed unless the owner asks.

Who may change these files: the owner and his attended sessions (the `watch` skill). The unattended turns (autopilot, the lead and mail passes, the follow-up sweep) have no file tool at all (`--tools ""`, pinned by `packages/agent/test/unattended-no-files.test.ts`): they read untrusted text, and the lens is code the server runs.

## What is kept

- Messages: 30 days. Moments and day counts: as long as the store lives.
- A moment's author handle and id: blanked after 180 days. Public group members are private people: the Hub never contacts them, never makes a client row of them, and shows them read only.

## The account

The list's `account` is `default` (the first connected Telegram user account) or one account id. Reading uses that account's own session. The account's client keeps no peers across a restart, so the store keeps each group's channel access hash (migration 0002) and reads by it: a restart costs no username lookup, and the day's lookup count is kept in the store too. A stale hash falls back to one lookup. A failing read (anything but a `FLOOD_WAIT`) backs that group off, 5 minutes and doubling to at most 6 hours, said on its Groups row; a group that shows its history only to members is marked "must be joined", and Join on the Groups view asks Telegram to add the account (a door: the admin's exact origin, `same-origin`, a loopback host). Whether a given group can be read without joining is known only after the first read.

## Commands

- `hub watch import <audience.sqlite> --project <slug>`: copies an experiment corpus (its chats, messages, windows and moments) into the project's store, so the page can be read with no account. Known rows are skipped.
- The installer step `watch.lens` (`./run.sh doctor --only watch.lens`) checks every `watch.md`, its lens's `lens.json` and its code.
- The `watch` skill (`skills/watch/SKILL.md`) is how a session reads the data (`sqlite3 -readonly data/watch/<slug>.db`, with recipes) and changes a list or a lens on the owner's word.

## Not built

- Shill detection (the experiment's `shill.py`).
- A second source in Watch (P79's found posts).

Update this page when the architecture changes.
