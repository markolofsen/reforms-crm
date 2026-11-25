# 28. The ops log

Status: in use (P86, 2026-11-20; P137 2026-11-24: one action id, the critical places, errors in view, 30-day retention). Code: `app/packages/log/src/ops/` (`@hub/log/ops`). Pairs with [25-agent-log.md](25-agent-log.md), which is a different log.

## What it is

One structured log for the server and every package: what failed or happened, one redacted JSON line each. The agent session log (`25`) is what the agent did in a session; the ops log is what broke or moved underneath: a messenger's disconnect with WhatsApp's or Telegram's own reason, a park, a flood wait, a Mail script or a Notion call that failed, a send the door refused or that failed, a terminal session that did not start, a migration, an HTTP 500, an unhandled rejection or exception. Before it, these went to `state/autostart/launchd.log` as unstructured text, or nowhere (a WhatsApp 401 at 18:07 on 2026-11-20 left no line).

## The line

`{"time","level","source","message","action"?,"fields"?}`, one per line, in `<state>/log/ops-<YYYY-MM-DD>.jsonl` (UTC day; `hubPaths().opsLog`, the same folder as the agent log, whose readers list only its project folders and so never see these files). Folder 700, file 600.

- `level`: `error` (something failed and nothing retries it, or a part stopped), `warn` (it failed and is retried, or a person's confirmed send was refused), `info` (a start, a stop, a purge), `debug` (kept only with `HUB_OPS_DEBUG=1`).
- `source`: a closed list (`OPS_SOURCES` in `src/ops/line.ts`): `server`, `whatsapp`, `telegram` (the owner's account), `telegram_bot`, `autolink`, `preanalysis` (P71 M-P, the cheap model's pass over linked chats), `autopilot` (decision 0048, P139: the messenger autopilot, one line per turn's outcome with the turn's action id; the same id is the turn's `hub mcp` `HUB_ACTION`, the door's `send` line and its `send_log` reference), `follow-ups` (decision 0050, P142: the daily sweep, one line per sweep and per client turn, each with its action id), `mail`, `notion`, `send`, `agent`, `terminal`, `knowledge`, `db`, `core`, `installer` (P137: `hub install` and `hub doctor` runs, backups). A new part adds a source there, and Overview's place for it in `apps/server/src/instance/ops-log-routes.ts` (`OPS_PLACE`, total over the list).
- `action` (P137 L1): the action the line belongs to (`@hub/config/action-id`, `w-kqzhtrvmab`): letters only, so no redactor rule touches it. See "One action id" below.
- `fields`: what says why (`status`, `kind`, `reason`, `account`, `project`, `draft`, `retryInS`, ...). A field named `code` is a secret (a login code): an error's code goes in `kind`, an HTTP or close status in `status`.

Writing: `ops("whatsapp").error("socket closed", { status, reason })`. The writer never throws and never blocks on more than one append. The file is resolved on the first write; a process with no instance (a CLI outside one) writes stderr only. Every line at `info` and above is also written to stderr as one human line (`18:07:12 error whatsapp: socket closed status=401 reason=...`), so `launchd.log` still reads as before; the session log hook writes the file only (its stderr would reach the session).

## One action id (P137 L1)

The owner's click, the server request it starts, the agent session and its `hub mcp` tool calls, and the Notion, Mail and send writes they make share one id, so a failure is read with what caused it instead of by time.

- The admin's generated client sends `x-hub-action` with every write (`packages/api/src/runtime/mutator.ts`, a fresh `w-` id; the busy retry resends it). The server (`apps/server/src/http/request-action.ts`) runs each request inside `withAction` (the header when it is a valid id, else a fresh `r-` id) and answers with the header. Every ops line written inside, however deep (`@hub/notion`, `@hub/mail-app`, the send door), carries it (`AsyncLocalStorage` in `src/ops/action.ts`).
- A terminal tab started by a click gets `HUB_ACTION` (`apps/server/src/terminal/terminal.ts`); `hub agent` keeps it or makes an `s-` id and passes it to the session's `hub` MCP server. `hub mcp` runs each tool call as the session's id plus five letters of the call id Claude Code sends (`claudecode/toolUseId`), and the session log's hooks stamp the same id on that call's events (`stampAction`, `@docs/core/25-agent-log.md`).
- `./run.sh logs --action <id>` shows one action's lines; a session's id includes its tool calls. The stderr copy and `hub logs` end a line with `action=<id>`.

## What is logged where (P137 L2)

One line at each critical place's outcome: `info` on success with its time (`ms`), `warn` on a refusal with its code or reasons, `error` once with the cause. `apps/installer/test/ops-critical-places.test.ts` lists the places and fails when one loses its line.

| Place | Source | Where |
|---|---|---|
| Send check (dry run): ready or its reasons | `send` | `apps/server/src/send/sends-routes.ts` |
| Send applied, refused, failed; the agent's send on the owner's word | `send` | same; a messenger send's failure in `packages/messengers/src/door.ts` |
| Batch send: check, start, each draft's outcome, the run's end | `send` | `sends-routes.ts`, `apps/server/src/send/batch-door.ts` |
| Mail draft saved, refused, Mail script failed, Mail slow | `mail` | `packages/mail-app/src/writer/{writer,protocol}.ts` |
| An agent tool that writes (draft, messenger draft, pointer, send): done, refused (its code), failed | `agent` | `packages/agent/src/mcp/define.ts` |
| Notion: a failed call, an SDK retry (rate limit, overload), a client card created or its chat field filled, the client map, the send stamp, lead Status | `notion` | `packages/notion/src/{notion,sdk-log,chat-client,client-map,stamp}.ts`, `apps/server/src/clients/leads-reader.ts` |
| Mail reads: a mailbox, a pass, Sent detection | `mail` | `apps/server/src/mail/{inbound,sent}.ts` |
| A messenger's receiver: connected, reconnected, a failed poll, stopped or parked | `telegram`, `telegram_bot`, `whatsapp` | `packages/messengers/src/poller.ts` |
| Agent session started, stopped, ended with an error, did not start | `agent` | `apps/server/src/terminal/terminal.ts` |
| Migrations applied, a migration failed | `db` | `packages/db/src/client.ts` |
| A backup (`--apply`), an install or doctor run (file only: the CLI prints its own table) | `installer` | `apps/installer/src/commands/backup/snapshot.ts`, `apps/installer/src/runner.ts` |
| A follow-up sweep: started, each client turn's decision or failure, the sweep's end or stop; a held autopilot nudge sent or dropped | `follow-ups` | `apps/server/src/follow-ups/` |
| A request slower than 2 s, a 5xx (`apps/server/src/http/request-action.ts`), a 500 with its stack (`app.ts`) | `server` | `apps/server/src/` |
| The retention run when it changed something | `server` | `packages/log/src/retention.ts` |

## Redaction (one place)

`redactOps` in `src/ops/redact.ts`, enforced by `app/packages/log/test/ops-redact.test.ts`. By name: a field whose key names a secret (`code`, `password`, `token`, `hash`, `session`, `secret`, `key`, `authorization`, `cookie`, `qr`, `otp`, `pin`, `credentials`, on the key's last word) is `***` whatever it holds; a field whose key names a body (`text`, `body`, `content`, `html`, `plain`, `message_text`, `caption`, `snippet`, `excerpt`, `quote`) is dropped as `[body omitted]`; a number of 6 or more digits under an identity key (`id`, `chat`, `phone`, `account`, `user`, `peer`, `jid`) is `[n]`. By shape, in every string: every value stored under `state/secrets` and the token shapes of `@hub/connections`, WhatsApp jids (`[jid]`), phone numbers (a run of 6 or more digits, or a `+` number with separators: `+[n]`), key-shaped base64 of 24 or more characters (`[key]`), emails (`m***@example.com`). A Notion error is logged by its status, code and class only (its message can quote a property). WhatsApp's own Baileys lines (`packages/messengers/src/whatsapp-log.ts`) go through the same redactor.

## Size and retention

30 days kept (P137 L4, `src/retention.ts`): the server, at start and every night, gzips each day file older than 2 days (`ops-<day>.jsonl.gz`, 600; the readers read it as a plain one) and deletes those older than 30; the session log's project folders follow the same rule (or `log.retention_days` when shorter). The first write of a day also deletes `ops-*` files older than 30 days. A day file past 20 MB keeps only `error` lines, after one `warn` line saying so; past 25 MB nothing more that day. `launchd.log` rotates on its own at 5 MB (`08`).

## Reading

- `./run.sh logs` (`hub logs`): `--level error` (the lowest level shown), `--source whatsapp,mail`, `--since 1h` (default 1 d), `--limit 50`, `--json` (the lines as stored), `--follow`. `hub log` is the agent session log.
- `--action <id>` (P137): one action's lines.
- Overview's **Recent errors** (folded, shown only when there is one): the newest 5 `error` lines of the last 24 h, each its source as a link to the page that fixes it (WhatsApp and Telegram: Messengers ▸ Settings; mail: Settings ▸ Mail; notion: Connections; send: Sending; agent, terminal: Settings ▸ Agent; knowledge: Knowledge; server, core, db: This Mac), when, and the message. `GET /api/ops/errors` (`@hub/contract/ops-log`), refetched on the live topic `ops-log` (the server watches today's file). Under the rows, "N errors in 24 h in Activity" links to Activity ▸ Errors.
- Activity ▸ **Errors** (P137 L3, `?kind=errors`): every `warn` and `error` line of the last 24 h for the whole Hub, newest first (at most 200), each with its level as an icon and a word, its part as a link to the page that fixes it, when, the message and its action id; the menu counts the day's errors. `GET /api/ops/lines`.
- The doctor's **`log.errors`** row (P137 L3, `apps/installer/src/steps/log.ts`, doctor only): FAIL on any `error` line of the last 24 h with the three most frequent messages and their counts, WARN past 50 warnings, else PASS with the warnings counted.

## Rules

- The server and every package write through `ops(source)`, never `console.*`: `apps/installer/test/ops-log-rules.test.ts` fails on a raw call outside its explicit list of CLI files that print to the person who ran them (rules README rule 18). The installer (the `hub` CLI) prints to the user throughout and is not walked.
- A failure point logs where it is caught, once: the poller logs a messenger's failures and its stop, the adapter the close with its reason, the send door its refusals of a confirmed send and its failures, the writer Mail's errors. A `.catch(() => undefined)` around work that can fail is a line, unless the failure is the answer (a dry run's refusal, a missing file that means "none").
- Never a message's or a mail's text, a login code or a token: name the field for what it is and the redactor does the rest.

## Privacy check (P137 L5)

The redactor is the one door; `@hub/log/leak-scan` checks after the fact that it held, over the files: no full address (a local part that is not `m***`), no message body under a body key, no token shape, no string a test names. Client addresses are masked, not hashed, in every line, the owner's own included (P137 verdict 6 asked for a hash with the owner's own kept; masking keeps less and was kept). `packages/log/test/log-privacy.test.ts` writes lines with an address, a body and tokens through the real logger and scans the file; `apps/admin/e2e/zz-log-privacy.spec.ts` scans the whole log folder of its stack after the run's flows (tokens in both logs; addresses, the seed's clients and bodies in the ops log).

## Tests

Under Vitest the logger writes no file and no stderr unless a test sets a sink (`captureOps()`), so no test writes into a real instance. `app/packages/log/test/ops-redact.test.ts` (the redactor), `ops-store.test.ts` (file, rotation, caps, reading, the stderr copy), `retention.test.ts` (gzip, delete, reading a `.gz` day), `log-privacy.test.ts`; `apps/installer/test/ops-critical-places.test.ts` (the places keep their lines), `log-errors-step.test.ts`; `apps/server/test/ops-log.test.ts` (both routes); the messenger privacy tests also assert that no line names an unlinked chat; `whatsapp-link.test.ts` that a 401 close is an `error` line with WhatsApp's reason.

Update this page when the architecture changes.
