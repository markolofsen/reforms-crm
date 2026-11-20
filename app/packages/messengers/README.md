# @hub/messengers

Messengers in the local CRM (track P8, decision 0003; track P71, decision 0036). Two channels today: a **Telegram bot on grammY 1.46.0, long polling** (no webhook, no tunnel), and the owner's own **Telegram user account over MTProto with mtcute 0.32.8** (P71 M1, receive only). WhatsApp as a linked device follows (P71 M5).

**Status.** Optional and receive-only in use. The server starts the poller when `state/secrets/telegram-bot-token` exists (`apps/server/src/messengers.ts`; `HUB_MESSENGERS=off` disables it) and reports its state in `/api/health`. The token is set on Settings ▸ Connections or with `hub token telegram` (access: `@docs/setup/access.md`); a new token applies on the next server start. There is no messenger inbox screen yet. Linking to the one client history with mail goes through `client_identifiers`.

## Two entries, on purpose

| Import | For | Contains |
|---|---|---|
| `@hub/messengers` | the agent, the server, tests | adapters, ingest, poller, `clientHistory`, `createDraft`, `normalizeIdentifier`, types. Nothing here links, approves or sends. |
| `@hub/messengers/human` | an entry point that knows a person is present | `humanActor`, `linkIdentifier`, `unlinkIdentifier`, `allowChat`, `linkUserChat`, `confirmDraft`, `sendConfirmed`, `copyDraft` (each needs a `HumanActor`); and a user account's login (`createLoginFlows`) and session writes (`writeSession`, `removeSession`): only a person logs in. |

Draft-only is enforced by types and by what can be imported, not by a prompt:

- An agent can only `createDraft` (status `draft`, chat must be allow-listed).
- `adapter.send` takes a `ConfirmedDraft`, a branded type minted by `confirmDraft` in `human.ts`. A hand-built or cast object is refused at run time (WeakSet check), and the package `exports` map blocks a deep import of the minter.
- A `HumanActor` is minted only by `humanActor()`: by the messengers CLI when stdin is a TTY, and by the server's Telegram user account link route behind the admin gate (exact admin Origin, loopback Host, `Sec-Fetch-Site: same-origin`; decision 0036 point 7).
- Channels `telegram_user` and `whatsapp` have no `send` at all: `copyDraft` returns the text and a link to open the chat.

## The Telegram user account (P71 M1)

The owner's own account (decision 0036; he connects his main number, the risk of a ban is his). Pieces:

| File | Does |
|---|---|
| `telegram-user.ts` | `createTelegramUserAdapter` over a small `MtClient` interface: mtcute's new-message events go into a bounded queue (1000) that `poll` drains, so `runPoller`, the cursor (the highest stored message id) and the backoff are the bot's one path. Private chats with people only (no groups, channels, bots or Saved Messages); text kept, media as its kind, both directions (`out` for his own replies). After a restart or an overflow the next poll reads the linked chats' history from the cursor. `toUserAdapterError`: `logged_out`, `banned` and a flood wait over an hour **park** the account (fatal for `runPoller`, recorded as `parked <code>: ...` in `messenger_accounts.last_error`, never retried by itself); a shorter flood wait is waited out; a socket error is `network` (backoff). |
| `telegram-user-api.ts` | The only file that imports mtcute: `MemoryStorage`, mtcute's log off, a dialog pass on connect to warm its in-memory peer cache (a bare user id cannot be resolved without it). Loaded lazily (`mtcuteClients()`). |
| `telegram-user-login.ts` | The login: `api_id` and `api_hash`, phone, code, 2FA password, one call each; values in memory for 10 minutes, never logged; refusals are sentences that never echo what was typed. Only the final session is stored. |
| `sessions.ts` | `state/secrets/sessions/telegram_user-<id>/session`, mode 600 in a 700 folder: the session string with the `api_id` and `api_hash` mtcute needs on every connect. Not in `app.db`, not backed up. |

Privacy (0036 point 3): a message from a chat that is not on the `telegram_user` allow-list is dropped in the event handler (and again at the drain), so it leaves no row, no counter and no log line. A chat enters the allow-list only by `linkUserChat` (the owner's pick in the dialog picker), which also imports its last 30 days. The picker reads dialogs on demand; suggestions match a dialog's Telegram id or phone against the client's identifiers (`client_identifiers` has no username kind, so a username is never a suggestion source). There is no `send` on this adapter in M1.

`@mtcute/node` depends on better-sqlite3 12; its native build is refused in `pnpm-workspace.yaml` (`allowBuilds: better-sqlite3: false`) because `MemoryStorage` never loads it. The server's supervisor is `apps/server/src/telegram-user.ts`.

## Data (migration 0003 in `@hub/db`)

`messenger_messages` (text kept in full, `retain_until` = stored + 90 days, `purge` deletes past it), `messenger_chats` (the inbound allow-list), `messenger_accounts` (poll cursor, last ok, last error), `client_identifiers` (client, kind `email|telegram|phone|whatsapp`, value; unique per project, kind and value), `messenger_drafts`.

Ingest stores only allow-listed chats and never links anything. Linking is `messengers link` by the owner.

## History

`clientHistory({ repos, mail }, project, clientId, { limit, cursor })` merges mail (any `MailHistory`-shaped reader, injected) with stored messenger rows, newest first. The cursor is a position in the merged order. Paging deep into old mail re-reads its newer pages; the reader is a local read, so that is cheap.

## CLI

`pnpm --filter @hub/messengers messengers -p <project> <command>`

| Command | Needs a person at a terminal | Does |
|---|---|---|
| `link <clientId> <kind> <value>` | yes | links an identity to a client; a chat is also allow-listed |
| `unlink <kind> <value>` | yes | removes the link and the allow-list entry |
| `allow` / `disallow <channel> <chatId>` | yes | lists a chat without a client |
| `status` | no | poll health (stale after 10 min), allow-list, counts, drafts |
| `poll [--once]` | no | the worker loop with offset persistence and backoff; `--once` fetches one batch and prints ids of unlisted chats |
| `purge` | no | deletes rows past retention |
| `confirm <draftId> [--no-send]` | yes | approves a draft and sends it (bot only) |
| `copy <draftId>` | yes | text and open-chat link for WhatsApp and user accounts |

## The bot token

A **new** bot from @BotFather, token alone in `state/secrets/telegram-bot-token` (chmod 600). Never the token of a bot that already has a webhook, and a webhook and `getUpdates` exclude each other. `start()` calls `deleteWebhook` on the bot it owns. The value is never logged; errors are scrubbed of anything token-shaped.

## Tests

`pnpm --filter @hub/messengers test`: Vitest, the `FakeAdapter`, `FakeMtClient` and `FakeLoginClient`, an in-memory database. No network, no real token, no Telegram login.
