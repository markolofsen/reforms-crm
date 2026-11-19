# reforms-crm @docs

An agent-first mail and CRM workflow on the owner's Mac. The agent does the work, the admin shows it, the owner decides. He starts an agent
session (Claude Code or Codex: `hub agent <project>`, or a tab of the admin's terminal dock) and hands it one instruction. The agent reads a project's
mail, updates the project's Notion CRM and leaves UNSENT drafts; the admin shows them within a second, and the owner sends one draft at a time.
The agent never sends, and nothing is scheduled.

## The whole system in five minutes

**The loop.** The agent (a session following a skill in `skills/`) reads mail through `mail-mcp` (Apple Mail; it has no send tool) and the project's
Notion CRM through the session's own Notion connector, leaves each reply as an unsent Mail draft and reports it with `hub record-draft`. The owner
opens the admin (`hub up`; it opens on Drafts), reads the draft, switches on "I read the checks" and presses Send; only then does the one door out of
the hub (`packages/send`, Apple Mail through `osascript`) send it, and only to recipients the project's send policy admits. The agent cannot reach that door.

**The four parts.**
| Part | Is | Does |
|---|---|---|
| Skills (`skills/`) | Instructions, not code | Tell an agent session what to do for what the owner asks, such as "triage the project's mail" ([skills/README.md](../skills/README.md)) |
| `hub` CLI (`app/apps/installer`) | Command line; `./run.sh` in an instance | Starts the agent (`hub agent`) and the admin (`hub up`), checks health (`hub doctor`), records a session's drafts and clients, serves the read-only `hub` MCP server (`hub mcp`), sets the send policy (`hub send policy`) |
| Server (`app/apps/server`) | Hono API on 127.0.0.1, port 4317 | Reads and writes the SQLite file `data/app.db`, streams what changed (`GET /api/live`), runs the confirmed Send, Sent detection (Apple Mail's Sent mailbox, while drafts wait), the terminal's sessions, the shared focus and the optional Telegram poller |
| Admin (`app/apps/admin`) | Next.js on 127.0.0.1, port 5173 | Drafts (the home), Activity, Project, Connections, and Overview with two or more projects; the terminal dock beside every screen. It shows what the agent did and holds the owner's decisions; it has no form to prepare work, no database handle, and talks only to the server |

**The admin.** One sidebar: the instance's brand on top (`name` and `logo` in `config/config.json`), the project switcher with two or more projects
(the project is then the first segment of every address, `/<project>/drafts/42`), the sections, and the Light, Dark, System switch. Drafts is a list
and the open draft beside it, with one View menu (To review, Hold, Thin basis, Finished, Follow-ups, Not by email, All). Activity is a table of what
the agent did with each client, grouped by session. Screens, routes and rules: [core/06-local-admin-app.md](core/06-local-admin-app.md).

**Live panels.** Every table of the database records each write in a counter (triggers, whoever writes: the server, `hub record-draft` in a terminal,
a migration). The server tails it and sends one small frame naming what changed on `GET /api/live`; the admin reads only that again. A draft the
agent writes shows within about a second, with no reload. Without the stream it falls back to polling: [core/06](core/06-local-admin-app.md), Live updates.

**After a restart of the Mac.** The admin and the API start at login (decision 0033, amending 0006's "no launchd"): one LaunchAgent per
instance runs `./run.sh up --service`, set up by `./run.sh setup` (step `autostart.agent`), switched in Connections > This Mac. It starts the
server only: no agent session starts until the dock is opened, and no browser opens: [core/08](core/08-local-app-stack.md).

**The terminal dock.** The admin always has a right-hand column (decision 0032) (a strip on the right edge when closed, Ctrl+`) whose tabs
run exactly `hub agent <project> --cli claude|codex`, or the owner's shell. Two session modes: attended (the CLI asks, the default) or
`agent.unattended: true` (no prompts, the OS sandbox on: no network from commands, the send policy and config read-only). In both the send tools
are denied, and a manual Send needs a single-use ticket only the admin page can mint: [core/24-terminal.md](core/24-terminal.md).

**Shared focus.** The admin tells the agent what it shows: the open draft, its client, the selected rows, the view. The agent reads it through the
`focus` tool of `hub mcp` and a `[Hub focus, data]` line the hub adds to each prompt, so "answer this client" means the draft on the screen, and
the dock's header says "Agent sees: draft N". The rules every session gets at start come from the core (`sessionRules()`), not from instance files:
[core/24-terminal.md](core/24-terminal.md), Shared focus.

**Where facts live.** Client records: Notion. Draft text: Mail. Draft review state ("I read the checks", Done, marks), batches, follow-up
enrollments and the agent log: SQLite. Each project's send policy: `state/projects/<slug>/send-policy.json`, written only by `hub send policy`.
Project facts, filters, knowledge, follow-up sequences and development plans (`@dev/`): plain files in `projects/<slug>/`. Secrets:
`state/secrets/`, mode 600, never in git. Table and rules: [core/06-local-admin-app.md](core/06-local-admin-app.md).

**Who reaches what.** Agents reach services through their own connectors (over MCP); the hub gives them local tools (Apple Mail through
`mail-mcp`, the database through `hub record-draft` and `hub record-client`, follow-ups through `hub sequences`, the knowledge MCP, the `hub` MCP,
the guard). Details: [core/02-connectors.md](core/02-connectors.md).
- Mail: Apple Mail only (decision 0026). The agent reads through `mail-mcp` and drafts through the `hub` MCP's `draft_write` (Mail stays in the background); the hub sends a confirmed draft and detects a sent one through `osascript`. There is no mail login and no mail key in the hub.
- Notion: the agent writes through the session's connector (no token); an optional integration token is what `notion-dump`, backups and the project doctor's database check read with.
- Telegram: an optional bot token (`state/secrets/telegram-bot-token`). With it the server polls for messages and stores them; it never sends ([packages/messengers/README.md](../app/packages/messengers/README.md)).

**The Connections page** (`/connections`, key `g c`; the same list in the terminal with `hub connections [--test]`) shows the Notion token and the
Telegram bot (whether each key is stored, who uses it, the last Test), the projects' mail accounts read-only, and Agent tools: per project and CLI,
whether a session has what it needs. A key goes from the form to the server and is never shown, returned or kept in the browser (decision 0020).

**Follow-ups.** A quiet client is enrolled in one of the project's follow-up sequences when the owner's words ask for it (recorded with the
enrolment; the agent never enrols on its own initiative); a session drafts each due step when asked, within the sequence's `max_words`, the owner
sends it, and a reply ends it. The hub never sends a step: [core/23-sequences.md](core/23-sequences.md).

**Lead forms.** The instance lists its public lead forms in `config/lead-forms.json`; `hub doctor --only Leads` checks that each one still takes a
lead, and `--canary` sends a signed test lead only to a handler that advertises it. An agent that changes a site, a form, a CSP, a proxy or a DNS
record runs it before it reports done (`app/@rules/agent-guardrails.md` rule 9): [core/22-lead-forms.md](core/22-lead-forms.md).

**Two layers.** Everything in this repository is **core** (universal design, code, skills, install). One owner's projects, history and secrets are
an **instance**, kept outside it and selected with `HUB_HOME`; it runs with `./run.sh`. Rule, path table and instance steps: [LAYERS.md](LAYERS.md).
A new document goes in `core/` only if it names no specific client, project, mailbox or person.

**The guards.** Draft-only is structural: no send tool in any agent session, and the server's only send route needs a person's confirmation of
the exact mail and the admin page's ticket. Both servers bind to loopback and refuse a foreign Host or Origin; the send ticket, the terminal socket
and the shared focus accept only the admin's exact Origin. No page shows a key.

The index of every document is [../README.md](../README.md#where-things-are); which credential goes to what is [setup/access.md](setup/access.md);
the working-order checklist is [setup/checklist.md](setup/checklist.md); frontend rules for the admin are [../app/@rules/README.md](../app/@rules/README.md).

Update this page when the architecture changes.
