# Public group watch

Draft decision 0052, track P144. A project can watch public Telegram groups: the Hub reads them with the owner's connected Telegram account, cuts the messages into windows, asks a model what each window says through the project's **lens**, and shows the result in the Watch section. Nothing is ever posted, reacted to, marked read or sent to a group or to anyone in it. This page is the whole mechanism.

## The parts

| Part | Where | What it does |
|---|---|---|
| The list | `<project>/watch.md` (instance data) | A settings table (`lens`, `on`, `account`, `poll_minutes`) and a `## Groups` list of public usernames. `on` is `no` by default: a restart never starts reading by itself. |
| The lens | `<home>/packages/<lens>/src/index.ts` (instance code) | The task the model runs on a window: its schema, its system text, which moments to keep, the trigger labels and its monthly budget. Declared with the kit the core hands it (`@hub/contract/lens`), so it imports nothing of the core. |
| The store | `<home>/data/watch/<slug>.db` | The project's own SQLite file: groups, messages, windows, moments and day counts. Its own migrations (`packages/watch/migrations`); only the server migrates it. `hub backup` copies it beside `app.db`. |
| The reader | `apps/server/src/watch/reader.ts` | Three calls only, over the account's one MTProto connection: resolve a username, read history after the last stored message, and join (only on the owner's click). No write method exists. |
| The watcher | `packages/watch/src/reader/poller.ts` | One per watch list. Ticks every 30 s and reads a group when its `poll_minutes` have passed; at most one call every 3 s, 20 resolves a day, 3 joins a run (3 to 4.5 minutes apart). Waits while the owner's own calls run. A `FLOOD_WAIT` parks the watcher for the wait plus an hour; the owner's chats are not touched. |
| The analysis | `packages/watch/src/analyse/job.ts` | Runs when a group has 100 new messages, or 6 hours after its last analysis. Windows of 100 messages with an overlap of 20 (the lens may change both); a moment repeated in the overlap is kept once. The lens task's budget is checked before every call, beside the instance cap. |

## What is kept

- Messages: 30 days. Moments and day counts: as long as the store lives.
- A moment's author handle and id: blanked after 180 days. Public group members are private people: the Hub never contacts them, never makes a client row of them, and shows them read only.

## The account

The list's `account` is `default` (the first connected Telegram user account) or one account id. Reading uses that account's own session; a group that shows its history only to members is marked "must be joined", and Join on the Groups view asks Telegram to add the account (a door: the admin's exact origin, `same-origin`, a loopback host). Whether a given group can be read without joining is known only after the first read.

## Commands

- `hub watch import <audience.sqlite> --project <slug>`: copies an experiment corpus (its chats, messages, windows and moments) into the project's store, so the page can be read with no account. Known rows are skipped.
- The installer step `watch.lens` checks every `watch.md` and its lens.

## Not built

- Shill detection (the experiment's `shill.py`).
- A second source in Watch (P79's found posts).
