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
| Admin (`app/apps/admin`) | Next.js on 127.0.0.1, port 5173 | The screens: Overview, Drafts, Bulk, Activity, Project, Connections. It holds no database handle and talks only to the server |

**Where facts live.** Client records: Notion. Draft text: Mail. Draft review state (Checked, Done, marks), bulk batches and the agent log: SQLite. Project facts,
filters and knowledge: plain files in `projects/<slug>/`. Secrets: `state/secrets/`, mode 600, never in git. Table and rules: [core/06-local-admin-app.md](core/06-local-admin-app.md).

**How mail, Notion and Telegram connect.** Each has a path that needs no secret and an optional one that adds numbers to the admin:
- Mail: Apple Mail through `mail-mcp` is how the agent reads and drafts, and how a confirmed draft is sent. A read-only IMAP login (`state/secrets/mail-<account>.json`) is optional; it adds the Overview's new-mail counts and Sent detection.
- Notion: the agent uses the session's connector (signed in with `/mcp` in Claude Code); no token. An integration token (`state/secrets/notion-token`, or `NOTION_TOKEN`) is what the Overview counts, `notion-dump` and the database check use.
- Telegram: an optional bot token (`state/secrets/telegram-bot-token`). With it the server polls for messages and stores them; it never sends. A new token applies on the next server start ([core/13-messengers-local.md](core/13-messengers-local.md)).
- WhatsApp is not connected.

**The Connections page** (`/connections`, key `g c`; the same list in the terminal with `hub connections [--test]`) shows each of these, whether its key is stored, who uses it
and the result of the last Test. You can set, replace and remove a key there. A key goes from the form to the server and is never shown, returned or kept in the browser
(decision 0020, [core/06](core/06-local-admin-app.md)). A Test is one read-only call to the provider.

**Two layers.** Everything in this repository is **core** (universal design, code, skills, install). One owner's projects, history and secrets are an **instance**, kept outside
it and selected with `HUB_HOME`. Rule, path table and instance steps: [LAYERS.md](LAYERS.md). A new document goes in `core/` only if it names no specific client, project, mailbox or person.

**The guards.** Draft-only is structural (no send tool in the agent's mail connector; the server's only send route needs a person's confirmation of the exact mail). Both servers bind to
loopback and refuse a foreign Host or Origin. No page shows a key.

Start here: [../README.md](../README.md), then [core/client-setup.md](core/client-setup.md) and [../skills/README.md](../skills/README.md).

| Doc | What it answers |
|---|---|
| [02-connectors.md](core/02-connectors.md) | The connectors a session uses: mail-mcp, the Notion MCP, what each can and cannot do |
| [06-local-admin-app.md](core/06-local-admin-app.md) | The local admin app: screens, the API, the Overview, the Connections page, where each fact lives |
| [08-local-app-stack.md](core/08-local-app-stack.md) | The TypeScript stack of the app (Next.js, React, coss, Hono, SQLite) and where files live (`HUB_HOME`) |
| [13-messengers-local.md](core/13-messengers-local.md) | Messengers in the local CRM (optional Telegram bot, receive only) |
| [14-bulk-send-interface.md](core/14-bulk-send-interface.md) | The bulk-send interface and the `bulk-drafts` skill |
| [15-notion-project-deploy-skill.md](core/15-notion-project-deploy-skill.md) | The skill and pack that deploy a project's CRM into Notion through the MCP |
| [notion/README.md](notion/README.md) | Notion setup: the CRM databases, every field (generated `fields.md`), connecting and building it |
| [16-projects-and-knowledge.md](core/16-projects-and-knowledge.md) | Many projects in one workflow: `project.md` schema v1, knowledge, routing, setup interview |
| [17-mail-filters.md](core/17-mail-filters.md) | Gmail filters that classify all incoming mail per project (rules file, safety rules, XML and API exporters, analyzer, Spam handling) |
| [18-kb-loop.md](core/18-kb-loop.md) | The knowledge loop: fact sources, KB-gap reports, privacy, `kb-review` |
| [19-calendar.md](core/19-calendar.md) | The `calendar` skill: Apple Calendar through osascript, holds without invitations, time zones and slots |
| [20-workflows.md](core/20-workflows.md) | Workflows: playbook files in the project folder, who may run which, `hub workflows` |
| [21-leads.md](core/21-leads.md) | Leads: the contract for anything that writes them, and the read-only counts |
| [client-setup.md](core/client-setup.md) | Installing the workflow: required steps first, optional automation after (generated by `hub docs`) |

The numbers are the ones the documents carry; gaps are documents that belong to an owner's instance. A new document takes the next free number and a row here.

Frontend rules for the local admin app (typing, routes, state, tokens, accessibility, structure; each with its enforcing gate): [../app/@rules/README.md](../app/@rules/README.md).

Read order for a new reader: the root README, `core/client-setup.md`, then the doc your task touches.
