# reforms-crm @docs

A local, manual-first mail and CRM workflow. The owner starts a Claude Code session (`hub agent <project>`) or Claude Desktop and hands it
ONE instruction. The agent reads a project's mail, updates the project's Notion CRM and leaves UNSENT drafts. Nothing runs in the
background on its own, the agent never sends, and a person sends one draft at a time from the local admin.

## The whole system in five minutes

**The loop.** The agent (a Claude session following a skill in `skills/`) reads mail through `mail-mcp` (Mail.app; it has no send tool) and the project's
Notion CRM through the session's own Notion connector, then leaves each reply as an unsent Mail draft and reports it with `hub record-draft`. The owner
opens the admin (`hub up`), reads the draft, marks it Checked and presses Send; only then does the one door out of the hub (`packages/send`, Mail.app through
osascript) send it. The agent cannot reach that door.

**The four parts.**
| Part | Is | Does |
|---|---|---|
| Skills (`skills/`) | Instructions, not code | Tell an agent session what to do for a phrase such as "triage the project's mail" ([skills/README.md](../skills/README.md)) |
| `hub` CLI (`app/apps/installer`) | Command line | Starts the agent (`hub agent`) and the admin (`hub up`), checks health (`hub doctor`), records drafts, lists connections (`hub connections`) |
| Server (`app/apps/server`) | Hono API on 127.0.0.1, port 4317 | Reads and writes the SQLite file `data/app.db`, builds the Overview, runs the confirmed Send, the Sent detection loop and the optional Telegram poller |
| Admin (`app/apps/admin`) | Next.js on 127.0.0.1, port 5173 | The screens: Overview, Drafts (a batch is a filter on it), Activity, Project, Connections. It holds no database handle and talks only to the server |

**Where facts live.** Client records: Notion. Draft text: Mail. Draft review state (Checked, Done, marks), bulk batches and the agent log: SQLite. Project facts,
filters, knowledge and development plans (`@dev/`): plain files in `projects/<slug>/`. Secrets: `state/secrets/`, mode 600, never in git. Table and rules: [core/06-local-admin-app.md](core/06-local-admin-app.md).

**How mail, Notion and Telegram connect.** Each has a path that needs no secret and an optional one that adds numbers to the admin:
- Mail: Apple Mail through `mail-mcp` is how the agent reads and drafts, and how a confirmed draft is sent. A read-only IMAP login (`state/secrets/mail-<account>.json`) is optional; it adds the Overview's new-mail counts and Sent detection.
- Notion: the agent writes through the session's connector (no token); an optional integration token is what the Overview counts, `notion-dump` and the database check read with.
- Telegram: an optional bot token (`state/secrets/telegram-bot-token`). With it the server polls for messages and stores them; it never sends. A new token applies on the next server start ([packages/messengers/README.md](../app/packages/messengers/README.md)).

**The Connections page** (`/connections`, key `g c`; the same list in the terminal with `hub connections [--test]`) shows each of these, whether its key is stored, who uses it
and the result of the last Test. You can set, replace and remove a key there. A key goes from the form to the server and is never shown, returned or kept in the browser
(decision 0020, [core/06](core/06-local-admin-app.md)). A Test is one read-only call to the provider.

**Two layers.** Everything in this repository is **core** (universal design, code, skills, install). One owner's projects, history and secrets are an **instance**, kept outside
it and selected with `HUB_HOME`. Rule, path table and instance steps: [LAYERS.md](LAYERS.md). A new document goes in `core/` only if it names no specific client, project, mailbox or person.

**The guards.** Draft-only is structural (no send tool in the agent's mail connector; the server's only send route needs a person's confirmation of the exact mail). Both servers bind to
loopback and refuse a foreign Host or Origin. No page shows a key.

The index of every document is [../README.md](../README.md#where-things-are); which credential goes to what is [setup/access.md](setup/access.md); the working-order checklist is [setup/checklist.md](setup/checklist.md).

**Follow-ups.** A quiet client can be enrolled by the owner in one of the project's follow-up sequences; a session drafts each due step when asked, the owner sends it from Mail, and a reply ends it. Nothing is scheduled and the hub never sends a step: [core/23-sequences.md](core/23-sequences.md).

Frontend rules for the local admin app (typing, routes, state, tokens, accessibility, structure; each with its enforcing gate): [../app/@rules/README.md](../app/@rules/README.md).

Update this page when the architecture changes.
