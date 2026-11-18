# reforms-crm @docs

A local, manual-first mail and CRM workflow. The owner starts a Claude Code session (`hub agent <project>`) or Claude Desktop and hands it
ONE instruction. The agent reads a project's mail, updates the project's Notion CRM and leaves UNSENT drafts. Nothing runs in the
background on its own, the agent never sends, and a person sends one draft at a time from the local admin. The agent does as much as possible; the admin shows what it did, and the owner only decides.

## The whole system in five minutes

**The loop.** The agent (a Claude session following a skill in `skills/`) reads mail through `mail-mcp` (Mail.app; it has no send tool) and the project's
Notion CRM through the session's own Notion connector, then leaves each reply as an unsent Mail draft and reports it with `hub record-draft`. The owner
opens the admin (`hub up`; it opens on Drafts), reads the draft, switches on "I read the checks" and presses Send; only then does the one door out of the hub (`packages/send`, Mail.app through
osascript) send it. The agent cannot reach that door.

**The four parts.**
| Part | Is | Does |
|---|---|---|
| Skills (`skills/`) | Instructions, not code | Tell an agent session what to do for a phrase such as "triage the project's mail" ([skills/README.md](../skills/README.md)) |
| `hub` CLI (`app/apps/installer`) | Command line | Starts the agent (`hub agent`) and the admin (`hub up`), checks health (`hub doctor`), records drafts, lists connections (`hub connections`) |
| Server (`app/apps/server`) | Hono API on 127.0.0.1, port 4317 | Reads and writes the SQLite file `data/app.db`, works out each project's standing, runs the confirmed Send, the Sent detection loop (Apple Mail's Sent mailbox, while drafts wait) and the optional Telegram poller |
| Admin (`app/apps/admin`) | Next.js on 127.0.0.1, port 5173 | The screens: Drafts (the home), Activity, Project, Connections, and Overview with two or more projects. It shows what the agent did and holds the owner's decisions; it has no form to prepare work. It holds no database handle and talks only to the server |

**Where facts live.** Client records: Notion. Draft text: Mail. Draft review state ("I read the checks", Done, marks), batches, follow-up enrollments and the agent log: SQLite. Project facts,
filters, knowledge and development plans (`@dev/`): plain files in `projects/<slug>/`. Secrets: `state/secrets/`, mode 600, never in git. Table and rules: [core/06-local-admin-app.md](core/06-local-admin-app.md).

**Who reaches what.** Agents reach services through their own connectors (Claude Code, Codex or Claude Desktop, over MCP); the hub gives them local tools (Apple Mail through `mail-mcp`, the database through `hub record-draft` and `hub record-client`, follow-ups through `hub sequences`, the knowledge MCP, the guard); the admin shows the state. Details: [core/02-connectors.md](core/02-connectors.md).
- Mail: Apple Mail only (decision 0026). The agent reads and drafts through `mail-mcp`; the hub sends a confirmed draft and detects a sent one through `osascript`. There is no mail login and no mail key in the hub.
- Notion: the agent writes through the session's connector (no token); an optional integration token is what `notion-dump`, backups and the project doctor's database check read with.
- Telegram: an optional bot token (`state/secrets/telegram-bot-token`). With it the server polls for messages and stores them; it never sends. A new token applies on the next server start ([packages/messengers/README.md](../app/packages/messengers/README.md)).

**The Connections page** (`/connections`, key `g c`; the same list in the terminal with `hub connections [--test]`) shows the Notion token and the Telegram bot, whether each key is stored, who uses it and the result of the last Test, and the projects' mail accounts read-only, with whether Apple Mail has them. You can set, replace and remove the Notion and Telegram keys there. A key goes from the form to the server and is never shown, returned or kept in the browser
(decision 0020, [core/06](core/06-local-admin-app.md)). A Test is one read-only call to the provider.

**Two layers.** Everything in this repository is **core** (universal design, code, skills, install). One owner's projects, history and secrets are an **instance**, kept outside
it and selected with `HUB_HOME`. Rule, path table and instance steps: [LAYERS.md](LAYERS.md). A new document goes in `core/` only if it names no specific client, project, mailbox or person.

**The guards.** Draft-only is structural (no send tool in the agent's mail connector; the server's only send route needs a person's confirmation of the exact mail). Both servers bind to
loopback and refuse a foreign Host or Origin. No page shows a key.

The index of every document is [../README.md](../README.md#where-things-are); which credential goes to what is [setup/access.md](setup/access.md); the working-order checklist is [setup/checklist.md](setup/checklist.md).

**Follow-ups.** A quiet client is enrolled in one of the project's follow-up sequences when the owner says so (in a session, his words are recorded with the enrolment; the agent never enrols on its own); a session drafts each due step when asked, the owner sends it from Mail, and a reply ends it. Nothing is scheduled and the hub never sends a step: [core/23-sequences.md](core/23-sequences.md).

**Lead forms.** The instance lists its public lead forms in `config/lead-forms.json`; `hub doctor --only Leads` checks that each one still takes a lead, and `--canary` sends a signed test lead only to a handler that answers the `OPTIONS` probe (`X-Canary-Probe: 1`) with `X-Canary-Accept: v1`. An agent that changes a site, a form, a CSP, a proxy or a DNS record runs it before it reports done (`app/@rules/agent-guardrails.md` rule 9): [core/22-lead-forms.md](core/22-lead-forms.md).

Frontend rules for the local admin app (typing, routes, state, tokens, accessibility, structure; each with its enforcing gate): [../app/@rules/README.md](../app/@rules/README.md).

Update this page when the architecture changes.
