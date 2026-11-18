# 06. Local admin app (the agent's own interface)

Status: built (`app/apps/admin` and `app/apps/server`; screens Drafts (home), Activity, Project, Connections, and Overview when the instance has two or more projects; Client planned). Next.js (decision 0015). English UI only.

## What
A small local web app (Next.js + React) on the owner's Mac. It shows what the agent did and holds the owner's decisions, nothing else (decision 0025): the drafts the agent left unsent in Mail, each with its reason and checks; what the agent did with every client, one group per session; the project's standing. The owner reads, then sends one draft at a time, skips, holds, marks done, flags a client or stops sending. Preparing (choosing clients, a brief, enrolling in follow-ups, sorting) is a phrase in a session; the admin has no form for it and shows the result. The agent may also change the app's own screens while the owner uses it (live edit); the dev server's hot reload shows the change at once.

Agents reach Mail and Notion through their own connectors (`mail-mcp` for Apple Mail, the session's Notion connector); the hub gives them local tools (`hub record-draft`, `hub record-client`, `hub sequences`, the knowledge MCP, the guard) and the database; the admin shows the state those leave.

It replaces a hosted helper app and, over time, the screens of a hosted back office that the agent now covers.

## Why local
- No hosting, no auth layer, no deploy chain: one owner, one Mac.
- The agent can read and edit the code of the app it serves; a hosted app cannot be changed that way.
- Data stays on the Mac: mail in Apple Mail, working state in `data/app.db` and `state/` under `HUB_HOME`, Notion through its MCP.

## Components
Base: coss ui (https://coss.com/ui), built on Base UI + Tailwind v4, shadcn-like registry plus a
particle catalogue of ready patterns. Skills `coss` and `coss-particles` are installed globally
(`~/.agents/skills`, symlinked to Claude Code). Rules from the skill that bind us:
- use existing primitives and particles first; do not invent APIs, check the docs;
- Drawer replaces Sheet; Hub's own rule is stricter: no dialogs or sheets for primary work, use inline disclosure;
- Tailwind v4 and `@base-ui/react` required.
- The copies and the product primitives live in the package `app/packages/ui` (`@hub/ui`), imported by subpath (`@hub/ui/button`, `@hub/ui/product/action-button`, `@hub/ui/cn`) with the tokens in `@hub/ui/styles.css`; the admin keeps only what knows its routes, hooks and API. Rules: `app/@rules/architecture-and-ownership.md` rule 15.

## Shape
- `reforms-crm/app/`: Next.js (App Router) + React + coss; real paths with the project in the query (`/drafts/42?project=...`), declared in `src/routes` and typed by the framework's typed routes. The pages are a client of a thin local
  server (Hono, on 127.0.0.1 only): the browser calls `/api/...` on its own origin and Next forwards it. The app holds no database handle, no secret (the Connections page may send a Notion or Telegram token to the server for storage and never receives or keeps one: decision 0020; mail has no key: decision 0026) and no Server Action; a `proxy.ts` refuses a foreign Host or Origin.
- Screens: Drafts (the home of every instance: the drafts the agent left unsent in Mail, one row per client that has one; one status line on top of the list), Activity (what the agent did: a table of its decisions, one row per client, grouped by session), Project (status and the one Stop sending, the send history, knowledge, mail filters and health one line each, the safety rules under Advanced), Connections (the Notion token and the Telegram bot: where each key stands, Test, and write-only set, replace and remove; the projects' mail accounts read-only, "Found in Apple Mail"; address `/connections`, no project in it), and Overview only with two or more projects (one sentence, then one table row per project). Planned: Client (profile and correspondence chain). Which screens exist and why: `app/@rules/README.md` rule 8a; what a screen may show: `app/@rules/admin-principles.md`.
- One shell for all of them: a sidebar with the brand header on top (the instance's `name` from `config/config.json`, fallback "Hub", and its `logo` file, else a monogram), the project switcher under it only with two or more projects, the sections with their counts and a dot on the section that fixes the worst fact, and the theme switcher (Light, Dark, System) in the footer; 224 px from 1280 px, a 56 px icon rail from 640 px, a bottom tab bar on a phone. A screen with a subject (Drafts, Activity) is a list (360 px, 400 px from 1440 px) and its detail side by side from 1024 px, and two screens with a Back control below it. There is no top bar and no status footer; each screen has one header line. Pages and lists fill the pane; only running text keeps a reading measure (about 70 characters). Every address is a real path with the project in the query; the open draft is the path (`/drafts/42`), the view and the search are the query, so Back, reload and a shared link restore the screen.
- The review card has one shape: who and why, what the draft was based on, the checks (only when there are some), the draft, then one action bar. The bar shows ONE primary button for the state the draft is in (Send, Send to Marta, Resume, Open in Mail, Reply in Mail) or none (queued, sent, done, skipped); at most two secondaries; the rest is in the More menu; the "I read the checks" switch gates Send. Flags (Follow up, VIP, Do not contact) are in the Client menu in the header, never near Send, and Do not contact asks first. The 16 states and their buttons (among them `follow_up`, a step of a follow-up sequence: Open in Mail as the primary, Stop follow-ups in the header; [23-sequences.md](23-sequences.md)) are the table in `app/apps/admin/src/features/review/card/card-state.ts` (research 16 section 7), held by a unit test and by `e2e/y-card-states.spec.ts`.
- Every reversible move says so: Done, Skip and Hold (one draft, or a selection) raise a toast with Undo, and `U` undoes the last one. The keys (`J K Enter Esc C X Shift+A R D S H U 1 2 3 T /`, `g` plus a letter between screens) are listed by the `?` popover; a typing field, a menu or a dialog switches them off.
- The client's history (`t` in a card) lists what the hub knows about that client: the agent's recorded decisions, the sends, and messenger messages (Telegram), with "Open in Mail" for the full mail thread; the hub reads no mail history itself (decision 0026).
- Marks (tags such as "follow up", "do not contact") live in the admin database (`marks`, `packages/db/src/schema.ts`); nothing copies them to Notion.
- Live editing: the agent changes files under `app/`; the owner sees the result without a rebuild (Next dev, Turbopack).
  Guard: the app runs from a git branch; every agent edit is a commit, so a bad one is one revert (`app/@rules/live-edit.md`).

## One source per fact (decision 0009)
Notion is the one place for client records; Mail is the one place for the text of a draft. The admin database
holds only what exists nowhere else.

| Data | Lives in | Admin database |
|---|---|---|
| Client profile, leads, tasks, documents (reports are documents, decision 0022) | Notion (the agent writes it through the connector) | only the key: a `clients` row (project, email, name, replies owed, last contact, `updated_at`), made when the agent records a draft for that client. Nothing is copied in bulk; there is no sync |
| Draft text | Mail (an unsent draft the person edits and sends) | no copy: `drafts.body` is empty for a recorded draft (an optional 240-character preview at most); `mail_ref` points at the message |
| Draft review state ("I read the checks", done, hold, skipped), marks, batches, follow-up enrollments, the agent's run log | admin database only | yes |
| Project facts, filters, knowledge | files under `<projects folder>/<slug>/` (`<HUB_HOME>/projects`; see `08-local-app-stack.md`) | an index rebuilt from them |

A session reports each unsent draft it leaves with `hub record-draft --project <slug>` (JSON on stdin; one JSON line out, exit
0 only when it says `"ok":true`). The command writes straight to the database (no server needed), makes the client row if
it is missing, and keeps one open draft per client: the same `mailRef` again updates it, another one marks the old draft
`skipped` and inserts the new one. It never deletes a client (marks and the log hang on that row) and never writes `sent`.
Sent detection (`14`) finds a recorded draft in the project's Sent mailbox in Apple Mail once the person has sent it from Mail.
Because Notion owns the client record, the admin has no company or deal-value column, no "High value" filter and no `{company}` placeholder.

## The routes behind the screens
Everything the server answers here is local: the database, the project folders and the server's own loops, read in the request. No route reads Mail or Notion to show a number, so no number carries a freshness stamp.

| Route | What it does | Cost |
|---|---|---|
| `GET /api/overview` | One row per project (status word, to review, sent today) with its standing (`statusDto`: level, the worst fact as one sentence, at most one place that fixes it, reply owed, last triage), a sentence that counts projects, and the health snapshot. With one project the admin shows the standing as the Drafts status line; with two or more, as the Overview table | milliseconds |
| `GET /api/activity` | The agent's decisions grouped by session: one row per client (who, what happened: drafted, skipped, escalated or flagged, the agent's reason, the draft it points at). One session is one run: every `hub record-draft` and `hub record-client` of a session joins the run of its `batchKey`. Model, tokens, cost and duration are null while unknown and the screen hides them | milliseconds |
| `GET /api/instance`, `GET /api/instance/logo` | The brand header's name and whether a logo exists; the logo file itself (404 when none), so the browser never learns a path | milliseconds |
| `GET /api/connections` | The Notion token and the Telegram bot, derived per request from `state/secrets/*`, the projects' settings and the in-memory test results, and each project's mail accounts with whether Apple Mail has them. No value: a row says where a key stands, never what it is | milliseconds |
| `PUT /api/connections/:id/secret` | Body `{ value }` (a Notion or Telegram token). Checks the shape, writes the file (temp and rename, mode 600), forgets the old test result, returns the row. 400 for a key that cannot be one, 409 where a key cannot be set. Nothing returns the value | milliseconds |
| `POST /api/connections/:id/remove` | Deletes the key file and returns the row. 409 for a key set by an environment variable or a row with no file | milliseconds |
| `GET /api/projects/:slug/agent-tools`, `POST .../agent-tools/refresh` | Connections' Agent tools: the last `agentChecks` rows of both CLIs for the project (computed on the first GET), and a rerun (each MCP server asked once per CLI) ([24-terminal.md](24-terminal.md)) | milliseconds; refresh about 10 seconds |
| `GET /api/terminal`, `POST /api/terminal/sessions`, `DELETE /api/terminal/sessions/:id`, `POST /api/terminal/tickets`, upgrade `/terminal` | The embedded terminal, off unless `terminal.enabled` (then 404, the state says `{enabled: false}`); the socket goes straight to the API port with the admin's exact origin and a single-use ticket ([24-terminal.md](24-terminal.md)) | milliseconds |
| `POST /api/sends/tickets` | A single-use ticket for one draft's Send (60 s), only for the admin's exact origin with `Sec-Fetch-Site: same-origin`; the apply of the send route needs it (P49 S12) | milliseconds |
| `GET /api/live` | The live stream (P50, below): `text/event-stream` of tiny frames that name what changed (`hello`, `change {seq, changes: [{topic, project}]}`, `reset`), never the data; resume by `Last-Event-ID` or `?since=`; a `: ping` every 15 s; at most 16 streams (then 503). Read-only, same Host guards, no CORS header | open while a page is |
| `POST /api/connections/:id/test` | One read-only probe of one connection (Notion `users/me`, Telegram `getMe`). At least 30 seconds between two probes of the same connection; the result is kept in memory for an hour. 404 unknown id, 409 when the connection has nothing to test | seconds |

**The standing of a project** is a pure function of local facts (for example Stop sending, a failing Sent loop or doctor check, held suspicious mail, failed or stuck sends, the project still a draft, sends limited to the test list, the fake Mailer, the auto-send cap, expired knowledge, never triaged), so the status line and the Overview read one source and a model writes no sentence. The worst fact wins and is said once ("Test mode: sends go to the test list only", "Sending is stopped", "All clear"); `next` names the one place that fixes it (Project or Connections), and that section carries a dot in the nav. The to-review count belongs to the nav and the View menu and is never repeated in the line. Paused and archived projects raise nothing.

The Notion token is optional for setup (`hub setup` asks for nothing; `hub setup --automation`, `./run.sh token notion` or the Connections page store it in `state/secrets/notion-token`, or in the file a project names in its settings; a project that names its own file never falls back to the shared one). It is read by the project doctor's database check, `notion-dump` and backups; the admin's home shows no Notion count.

What the Overview never carries: a client's name, address, subject or body, a deal value, a Notion property or a Notion page id of a record. The schemas have no field for them and refuse a stray one.

## Live updates (P50, decision 0028 in the owner's plan repo)
While the agent works (in the terminal column or another window) the screens update by themselves, within about a second, with no reload:
- **What changed is written by the database itself.** Migration 0019 gives every table three triggers (insert, update, delete) that bump one counter (`live_seq`) and record `(table, project, counter)` in `live_versions`, inside the writer's own transaction, whoever writes: the server, `hub record-draft` in a terminal, a migration, `sqlite3` by hand. A rolled-back write records nothing. The table holds one row per table and project, so it never needs pruning and every counter stays a resume point. What is not a row is watched by the server and bumped through the same path (`bumpTopic`): the pollers' state (`health`) and the Connections files (`connections`, so a `hub token` in a terminal shows at once). A new table needs its triggers in its migration; `packages/db/src/live.test.ts` fails without them, and the server's `Record<LiveTable, LiveTopic>` fails `tsc`.
- **The server tails it.** Every 200 ms it reads the counter (one page); when it moved, it reads the changed rows, maps each table to one of 13 topics (`@hub/contract/live`), waits 100 ms to merge a burst, and sends one frame on `GET /api/live`. A client still busy with the last frame gets one `reset` instead of a queue.
- **The admin invalidates, it is never pushed data.** One tab per browser holds the Web Lock `hub-live` and opens the EventSource (HTTP/1.1 allows about six connections per origin across all tabs); it passes every frame to the other tabs over a `BroadcastChannel`. Each tab invalidates the query keys of the frame's topics (`TOPIC_KEYS` in `apps/admin/src/lib/cache/keys.ts`, the one key factory), so only what changed is read again, through the normal API and its contract parse. A hidden tab only marks its queries stale; its focus refetch catches up. A frame never reads Mail (decision 0013): the open draft's text in Mail is read on open and focus, and when the agent changed a draft under an open card, the card says "Changed by the agent since you opened it" with Reload. New Activity sessions are announced in a polite live region ("2 new").
- **The fallback is the pulse.** The Drafts status line says "Live" while the stream is up and "Reconnecting, data may be old" after 5 s without it. While it is down, the page polls `GET /api/pulse` every 10 s as before P50 and refetches every list when the database file moved; a stream the server cut (a restart: the `/api` rewrite answers 500) is opened again after 1, 2, then 5 s, resuming after the last frame the page applied. The Activity and Overview timers are gone.
- **Through the `/api` rewrite.** The stream goes through Next's rewrite like every call, so `proxy.ts` and the Host guard apply unchanged and no ticket is needed (a cross-origin page cannot read a same-origin stream without CORS). `Cache-Control: no-cache, no-transform` is load-bearing: without it Next gzips the proxied stream and holds every frame (measured in the L0 spike: 0 frames in 8 s; with it 1 to 4 ms per frame, and a stream with only 15 s pings stayed open past 165 s under the 120 s `proxyTimeout`).

## What a screen shows by default
Each screen opens on what the next decision needs and keeps the rest one step away (`app/@rules/admin-principles.md`). Drafts has one View menu with counts (`DRAFT_VIEWS`, `app/apps/admin/src/routes/search.ts`; the view is `?filter=`): To review (`ready`), Hold, Thin basis (`thin_basis`: drafts whose record says too little was read), Finished (done, sent, skipped), Follow-ups (`sequences`, the open steps of a follow-up sequence, [23-sequences.md](23-sequences.md)), Not by email, All, and the batches read-only (`?batch=`). Above the list sits one status line, never a paragraph or an accordion. A row is three lines (name and time, the subject on the full width, a line of chips); selecting turns the list's header line into "N selected · Skip · Hold · Clear" in place, so nothing moves. The list footer "N of N loaded" shows only when there is more to load. On Project the health line shows the failed checks and stays closed when all pass. A mechanical cap holds the first viewport to 36 tab stops and the first draft on a phone to 200 px down (`app/@rules/ui-specifications.md` rule 4a).

## Rules
- The agent only creates drafts. The app sends only when a person confirms one draft (decision 0011, `16` section 3B): Send on a ready draft whose checks the person read ("I read the checks", bound to the Mail text they saw), with the exact mail shown first, through the one route `POST /api/projects/:slug/drafts/:id/send`, whose apply needs the page's single-use ticket. Bulk = many drafts, never sent in bulk.
- The terminal column (when `terminal.enabled`) runs Claude Code, Codex or the owner's shell for the project in the URL; it is a viewing preference in `localStorage`, never URL state ([24-terminal.md](24-terminal.md)).
- Bind to 127.0.0.1 (`next dev -H 127.0.0.1`: without the flag Next listens on every address); no remote access in the first version. Next has no DNS-rebinding guard of its own, so `src/proxy.ts` refuses any Host that is not a loopback name and any write whose Origin is not; the API repeats the check.
- English only, per the owner.

## Not built
The Client screen (profile and correspondence chain).

## Open questions for the owner
- Mobile access to the app (phone on the same network) needed, or desktop only?

Update this page when the architecture changes.
