# 06. Local admin app (the agent's own interface)

Status: built (`app/apps/admin` and `app/apps/server`; screens Overview, Drafts, Bulk, Activity, Project; Client and Reports still planned). Rebuilt on Next.js in 2026-11 (decision a decision or plan record kept in the owner's instance, cutover 2026-11-15). Originally an idea from the owner, 2026-11-14. English UI only.

## What
A small local web app (Next.js + React) that the workflow agent starts on the always-on Mac. The owner
opens it on localhost to work with the agent: see clients and the agent's findings, mark clients
(what to do with each), run bulk actions (for example one message to many), and change the app's own
screens while using it. The agent edits the app's source; the dev server's hot reload shows the change at once.

It replaces a hosted helper app and, over time, the screens of a hosted back office that the agent now covers.

## Why local
- No hosting, no auth layer, no deploy chain: one owner, one Mac.
- The agent can read and edit the code of the app it serves; a hosted app cannot be changed that way.
- Data stays on the Mac: mail history, profiles in `state/` under `HUB_HOME`, Notion through its MCP.

## Components
Base: coss ui (https://coss.com/ui), built on Base UI + Tailwind v4, shadcn-like registry plus a
particle catalogue of ready patterns. Skills `coss` and `coss-particles` are installed globally
(`~/.agents/skills`, symlinked to Claude Code). Rules from the skill that bind us:
- use existing primitives and particles first; do not invent APIs, check the docs;
- Drawer replaces Sheet; Hub's own rule is stricter: no dialogs or sheets for primary work, use inline disclosure;
- Tailwind v4 and `@base-ui/react` required.

## Shape
- `reforms-crm/app/`: Next.js (App Router) + React + coss; real paths with the project in the query (`/drafts/42?project=...`), declared in `src/routes` and typed by the framework's typed routes. The pages are a client of a thin local
  server (the `05` MCP tools exposed over HTTP on 127.0.0.1 only): the browser calls `/api/...` on its own origin and Next forwards it. The app holds no database handle, no secret and no Server Action; a `proxy.ts` refuses a foreign Host or Origin.
- Screens: Overview (one picture of every project), Drafts (the main screen: the drafts the agent left unsent in Mail, one row per client that has one, with
  Checked, Done, marks and an Open in Mail link), Activity (the agent's log), Bulk (pick clients, agent drafts, owner reviews, drafts land in Mail,
  nothing is sent), Project (health, safety rules, send history, Stop sending). Planned: Client (profile + correspondence chain, `mail_history`), Reports.
- Marks (tags such as "follow up", "do not contact") live in the client profile file and sync to Notion.
- Live editing: the agent changes files under `app/`; the owner sees the result without a rebuild (Next dev, Turbopack).
  Guard: the app runs from a git branch; every agent edit is a commit, so a bad one is one revert (`app/@rules/live-edit.md`).

## One source per fact (decision 0009)
Notion is the one place for client records; Mail is the one place for the text of a draft. The admin database
holds only what exists nowhere else.

| Data | Lives in | Admin database |
|---|---|---|
| Client profile, leads, tasks, reports | Notion (the agent writes it through the connector) | only the key: a `clients` row (project, email, name, replies owed, last contact, `updated_at`), made when the agent records a draft for that client. Nothing is copied in bulk; there is no sync |
| Draft text | Mail (an unsent draft the person edits and sends) | no copy: `drafts.body` is empty for a recorded draft (an optional 240-character preview at most); `mail_ref` points at the message |
| Draft review state (Checked, Done, hold, skipped), marks, bulk batches, agent log | admin database only | yes |
| Project facts, filters, knowledge | files under `<projects folder>/<slug>/` (`<HUB_HOME>/projects`; see `08-local-app-stack.md`) | an index rebuilt from them |

A session reports each unsent draft it leaves with `hub record-draft --project <slug>` (JSON on stdin; one JSON line out, exit
0 only when it says `"ok":true`). The command writes straight to the database (no server needed), makes the client row if
it is missing, and keeps one open draft per client: the same `mailRef` again updates it, another one marks the old draft
`skipped` and inserts the new one. It never deletes a client (marks and the log hang on that row) and never writes `sent`.
Sent detection (`14`) reads the Sent folder for recorded drafts exactly as for bulk ones.
Because Notion owns the client record, the admin has no company or deal-value column, no "High value" filter and no `{company}` placeholder.

## The Overview: one picture of every project
The server answers two routes for the Overview page. Both are read only: nothing here sends, drafts, marks or writes to Mail or Notion.

| Route | What it does | Cost |
|---|---|---|
| `GET /api/overview` | Assembles the page from the database, the project folders and the server's in-memory cache of live numbers. Makes no network call. Returns the verdict, the ordered attention list, one card per project and the health snapshot | milliseconds (under 100 ms for ten projects) |
| `POST /api/overview/refresh` | Body `{ project, sources }` with `sources` of `mail`, `notion` or both. Reads Mail or Notion for that project only, updates the cache, returns the project's card and the recomputed list. 404 for an unknown or archived project | seconds: see below |

Three classes of number, said on every card. **Local** numbers (drafts by status, sends today, failed and stuck sends, the Stop all switch, held suspicious mail, expired knowledge, setup checks) are read in the request and are always current. **Live** numbers (clients waiting in a mailbox since the last triage, rows in a Notion data source) are read only on a Refresh: IMAP search and header fetches (never a message body, never Drafts), and a Notion data source query that returns a count (never a property). **Agent** numbers (clients owed a reply) are what the last triage reported and say so; until the inbox rows exist they are `off`, "Not recorded yet", never a zero.

**No number without a stamp.** Every live number carries the time it was read and a state: `fresh` (younger than 15 minutes for mail, 60 for Notion), `stale` (older, still shown and labelled), `never` (not read since the server started), `refreshing`, or `error`. An `error` keeps the last good number beside a one-sentence reason and a fix line; the provider's own text, a login and a token are never in the answer. The cache lives in server memory only: a restart shows "not read yet", and no Notion fact is copied into the database (decision 0009, the cache holds integers). One Refresh per project and source runs at a time (a second call shares it), and two Refresh calls less than 30 seconds apart share the earlier read; the answer says which happened (`read`, `joined`, `too-soon`). The page never refreshes from the 10 second pulse.

What a live number means. *New since the last triage* counts messages that arrived since the later of the last triage and 14 days ago, whose sender is not one of the project's own addresses, that nobody answered later in the same thread (matched by `In-Reply-To` and `References`, then by subject and recipient), leaving out senders the project's mail filters call non-clients. The Sent folder is read for this even when the account is limited to the inbox. Without filter rules, or without a readable Sent folder, the number is an upper bound and says so. *Notion rows* are counted page by page up to 2 000 rows, then shown as "2 000+".

Cost, measured: counting 50 000 headers in memory takes about a second and 15 MB; a Notion data source of about 1 200 rows takes about 13 seconds (the provider's latency, one request per 100 rows, not the 3 requests per second throttle). A mailbox read is limited to 10 seconds per account and a data source to 30 seconds, then the card shows a timeout and the fix.

The Notion token is a required setup condition, not an option: it always exists (`state/secrets/notion-token`, or the file a project names in its settings; a project that names its own file never falls back to the shared one). A missing or rejected token is a failure with a fix line on the card and in the setup check (`hub doctor`), never a quiet "not connected" state. A mailbox with no login yet is the one `off` state, because mail logins are added one account at a time.

The attention list is a pure function of these facts, so the page and any status line read one source and a model writes no sentence. Each item has a kind from a closed list, a severity (`blocker`: nothing can work or send; `needs-owner`: a person must decide; `watch`: look when convenient), a sentence of the form "what happened. What to do." and a place to go (`drafts`, `project` or `overview`, with an optional `ready` or `hold` filter): the server never writes an address. The verdict is derived from the list: all clear only when no blocker and no needs-owner item exists. Paused and archived projects raise nothing.

What the Overview never carries: a client's name, address, subject or body, a deal value, a Notion property or a Notion page id of a record. The schemas have no field for them and refuse a stray one.

## Rules
- The agent only creates drafts. The app sends only when a person confirms one draft (decision 0011, `16` section 3B): Send on a ready, Checked draft, with the exact mail shown first. Bulk = many drafts, never sent in bulk.
- Bind to 127.0.0.1 (`next dev -H 127.0.0.1`: without the flag Next listens on every address); no remote access in the first version. Next has no DNS-rebinding guard of its own, so `src/proxy.ts` refuses any Host that is not a loopback name and any write whose Origin is not; the API repeats the check.
- English only, per the owner.

## Next steps
The spike, the local server (Hono, decision 0001) and the live edit are done. Left: the Client and Reports screens, and listing which Hub screens the app absorbs, to add to `04`.

## Open questions for the owner
- Mobile access to the app (phone on the same network) needed, or desktop only?
- Which first bulk action: follow-up to silent clients, or a notice to a segment?
