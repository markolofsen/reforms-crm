# @hub/messengers

Messengers in the local CRM (track P8, decision 0003). v1 is one channel: a **Telegram bot on grammY 1.46.0, long polling**. No webhook, no tunnel (polling needs no public address).

**Status.** Optional and receive-only in use. The server starts the poller when `state/secrets/telegram-bot-token` exists (`apps/server/src/messengers.ts`; `HUB_MESSENGERS=off` disables it) and reports its state in `/api/health`. The token is set on the Connections page or with `hub token telegram` (access: `@docs/setup/access.md`); a new token applies on the next server start. There is no messenger inbox screen yet. Linking to the one client history with mail goes through `client_identifiers`.

## Two entries, on purpose

| Import | For | Contains |
|---|---|---|
| `@hub/messengers` | the agent, the server, tests | adapters, ingest, poller, `clientHistory`, `createDraft`, `normalizeIdentifier`, types. Nothing here links, approves or sends. |
| `@hub/messengers/human` | an entry point that knows a person is present | `humanActor`, `linkIdentifier`, `unlinkIdentifier`, `allowChat`, `confirmDraft`, `sendConfirmed`, `copyDraft`. Each needs a `HumanActor`. |

Draft-only is enforced by types and by what can be imported, not by a prompt:

- An agent can only `createDraft` (status `draft`, chat must be allow-listed).
- `adapter.send` takes a `ConfirmedDraft`, a branded type minted by `confirmDraft` in `human.ts`. A hand-built or cast object is refused at run time (WeakSet check), and the package `exports` map blocks a deep import of the minter.
- A `HumanActor` is minted only by `humanActor()`. Only the messengers CLI mints one, and only when stdin is a TTY; the server mints none (the admin has no sign-in).
- Channels `telegram_user` and `whatsapp` have no `send` at all: `copyDraft` returns the text and a link to open the chat.

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

`pnpm --filter @hub/messengers test`: Vitest, the `FakeAdapter`, an in-memory database. No network, no real token.
