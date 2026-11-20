# 28. The ops log

Status: in use (P86, 2026-11-20). Code: `app/packages/log/src/ops/` (`@hub/log/ops`). Pairs with [25-agent-log.md](25-agent-log.md), which is a different log.

## What it is

One structured log for the server and every package: what failed or happened, one redacted JSON line each. The agent session log (`25`) is what the agent did in a session; the ops log is what broke or moved underneath: a messenger's disconnect with WhatsApp's or Telegram's own reason, a park, a flood wait, a Mail script or a Notion call that failed, a send the door refused or that failed, a terminal session that did not start, a migration, an HTTP 500, an unhandled rejection or exception. Before it, these went to `state/autostart/launchd.log` as unstructured text, or nowhere (a WhatsApp 401 at 18:07 on 2026-11-20 left no line).

## The line

`{"time","level","source","message","fields"?}`, one per line, in `<state>/log/ops-<YYYY-MM-DD>.jsonl` (UTC day; `hubPaths().opsLog`, the same folder as the agent log, whose readers list only its project folders and so never see these files). Folder 700, file 600.

- `level`: `error` (something failed and nothing retries it, or a part stopped), `warn` (it failed and is retried, or a person's confirmed send was refused), `info` (a start, a stop, a purge), `debug` (kept only with `HUB_OPS_DEBUG=1`).
- `source`: a closed list (`OPS_SOURCES` in `src/ops/line.ts`): `server`, `whatsapp`, `telegram` (the owner's account), `telegram_bot`, `autolink`, `preanalysis` (P71 M-P, the cheap model's pass over linked chats), `mail`, `notion`, `send`, `agent`, `terminal`, `knowledge`, `db`, `core`. A new part adds a source there, and Overview's place for it in `apps/server/src/routes/ops-log.ts` (`OPS_PLACE`, total over the list).
- `fields`: what says why (`status`, `kind`, `reason`, `account`, `project`, `draft`, `retryInS`, ...). A field named `code` is a secret (a login code): an error's code goes in `kind`, an HTTP or close status in `status`.

Writing: `ops("whatsapp").error("socket closed", { status, reason })`. The writer never throws and never blocks on more than one append. The file is resolved on the first write; a process with no instance (a CLI outside one) writes stderr only. Every line at `info` and above is also written to stderr as one human line (`18:07:12 error whatsapp: socket closed status=401 reason=...`), so `launchd.log` still reads as before; the session log hook writes the file only (its stderr would reach the session).

## Redaction (one place)

`redactOps` in `src/ops/redact.ts`, enforced by `app/packages/log/test/ops-redact.test.ts`. By name: a field whose key names a secret (`code`, `password`, `token`, `hash`, `session`, `secret`, `key`, `authorization`, `cookie`, `qr`, `otp`, `pin`, `credentials`, on the key's last word) is `***` whatever it holds; a field whose key names a body (`text`, `body`, `content`, `html`, `plain`, `message_text`, `caption`, `snippet`, `excerpt`, `quote`) is dropped as `[body omitted]`; a number of 6 or more digits under an identity key (`id`, `chat`, `phone`, `account`, `user`, `peer`, `jid`) is `[n]`. By shape, in every string: every value stored under `state/secrets` and the token shapes of `@hub/connections`, WhatsApp jids (`[jid]`), phone numbers (a run of 6 or more digits, or a `+` number with separators: `+[n]`), key-shaped base64 of 24 or more characters (`[key]`), emails (`m***@example.com`). A Notion error is logged by its status, code and class only (its message can quote a property). WhatsApp's own Baileys lines (`packages/messengers/src/whatsapp-log.ts`) go through the same redactor.

## Size

7 days kept: the first write of a day deletes older `ops-*.jsonl` files. A day file past 20 MB keeps only `error` lines, after one `warn` line saying so; past 25 MB nothing more that day. `launchd.log` rotates on its own at 5 MB (`08`).

## Reading

- `./run.sh logs` (`hub logs`): `--level error` (the lowest level shown), `--source whatsapp,mail`, `--since 1h` (default 1 d), `--limit 50`, `--json` (the lines as stored), `--follow`. `hub log` is the agent session log.
- Overview's **Recent errors** (folded, shown only when there is one): the newest 5 `error` lines of the last 24 h, each its source as a link to the page that fixes it (WhatsApp and Telegram: Messengers ▸ Settings; mail: Settings ▸ Mail; notion: Connections; send: Sending; agent, terminal: Settings ▸ Agent; knowledge: Knowledge; server, core, db: This Mac), when, and the message. `GET /api/ops/errors` (`@hub/contract/ops-log`), refetched on the live topic `ops-log` (the server watches today's file).

## Rules

- The server and every package write through `ops(source)`, never `console.*`: `apps/installer/test/ops-log-rules.test.ts` fails on a raw call outside its explicit list of CLI files that print to the person who ran them (rules README rule 18). The installer (the `hub` CLI) prints to the user throughout and is not walked.
- A failure point logs where it is caught, once: the poller logs a messenger's failures and its stop, the adapter the close with its reason, the send door its refusals of a confirmed send and its failures, the writer Mail's errors. A `.catch(() => undefined)` around work that can fail is a line, unless the failure is the answer (a dry run's refusal, a missing file that means "none").
- Never a message's or a mail's text, a login code or a token: name the field for what it is and the redactor does the rest.

## Tests

Under Vitest the logger writes no file and no stderr unless a test sets a sink (`captureOps()`), so no test writes into a real instance. `app/packages/log/test/ops-redact.test.ts` (the redactor), `ops-store.test.ts` (file, rotation, caps, reading, the stderr copy); the messenger privacy tests also assert that no line names an unlinked chat; `whatsapp-link.test.ts` that a 401 close is an `error` line with WhatsApp's reason.

Update this page when the architecture changes.
