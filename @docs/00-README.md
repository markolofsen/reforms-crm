# reforms-crm @docs

An agent-first mail and CRM workflow on the owner's Mac. The agent does the work, the admin shows it, the owner decides. He starts an agent
session (Claude Code or Codex: `hub agent <project>`, or a tab of the admin's terminal dock) and hands it one instruction. The agent reads a project's
mail, updates the project's Notion CRM and leaves UNSENT drafts; the admin shows them within a second, and the owner sends one draft at a time (a batch's Checked drafts with one confirmed Send all Checked, still sent one by one through the same door).
The agent never sends. The Hub starts no agent on a timer (a cheap LLM call through `@hub/llm` may run only inside work already running: [core/27-llm.md](core/27-llm.md)).

## The whole system in five minutes

**The loop.** A session follows a skill in `skills/`. It reads mail through `mail-mcp` (Apple Mail; no send tool), writes the client's Notion
record through its own Notion connector, and writes each reply as an unsent Mail draft with the `hub` MCP's `draft_write`. The Hub knows its
Mail drafts by its own record of each version it wrote, never by a line in the text, and the session records the draft with `draft_write`'s record.
The owner reads the draft in the admin, switches on "I read the checks" and presses Send: [core/06-local-admin-app.md](core/06-local-admin-app.md).

**The parts.**
| Part | Is | Does |
|---|---|---|
| Skills (`skills/`) | Instructions, not code | Tell a session what to do for what the owner asks, such as "triage the project's mail" ([skills/README.md](../skills/README.md)) |
| `hub` CLI (`app/apps/installer`) | Command line; `./run.sh` in an instance | Starts a session (`hub agent`) and the admin (`hub up`), checks health (`hub doctor`), records a session's drafts and clients, serves the `hub` MCP server (`hub mcp`), sets the send policy, updates the core |
| Server (`app/apps/server`) | Hono API on 127.0.0.1, port 4317 by default | Owns `data/app.db`, streams what changed, runs the confirmed Send and Sent detection, the terminal's sessions and drops, the shared focus, the autostart switch, the core-update check and the messenger receivers |
| Admin (`app/apps/admin`) | Next.js on 127.0.0.1, port 5173 by default | Seven sections and the terminal dock. It shows what the agent did and holds the owner's decisions; it has no form to prepare work and talks only to the server |
| Packages (`app/packages`) | One subject each | Mail drafts and sessions (`agent`), send checks (`send`), database (`db`), messengers, the LLM door (`llm`), the agent log (`log`), knowledge, projects, sequences, the UI kit: [core/08-local-app-stack.md](core/08-local-app-stack.md) |

**The admin's screens.** One sidebar: the instance's brand, the project switcher with two or more projects, the seven sections, and in the footer
the core version line, the theme and the sound switch (P73: no agent feed rows). The address `/` opens Mail with one project and Overview with two or more; with two
or more the project is the first segment of every scoped address (`/<project>/mail/c/42`). Routes and rules: [core/06-local-admin-app.md](core/06-local-admin-app.md).
- **Overview** (`/overview`): what needs the owner. Each broken part of the Hub with its fix line and one link, or "Everything works"; every part folded under "All parts"; one row per project first when there are two or more. It reads and never writes.
- **Mail** (`/mail`, `/mail/c/7`, `/mail/lead/<page>`; Drafts until P96): the home. Since P99 it lists people, not drafts: one row per client with one state word (Wrote you, Draft ready, Waiting for them, Done), newest activity first; the View menu is Needs you (the default), Waiting and All, with Follow-ups and Not by email as filters; New leads stay a group under the people. Opening a person shows the whole correspondence across threads, read from Mail on open and never stored, a divider per thread with its subject and brand, and at the bottom the one open draft as the unsent message: the Mail text, the checks, Checked, Send, Skip, Hold and Done. A person who wrote with no draft has Prepare reply (pasted into the dock without Enter) and No reply needed. The status line keeps the new leads and "Mail read N min ago · Check now". Bulk drafts and batches: [core/14-bulk-send-interface.md](core/14-bulk-send-interface.md).
- **Messengers** (`/messengers`, `/messengers/settings`): a review queue of the linked Telegram and WhatsApp chats, not a chat client. Chats lists what waits (the agent's open draft with Send, Edit and Skip, or why there is none) and the fresh unlinked chats to link or hide; Settings connects the owner's own accounts and holds each linked chat's rules: [core/06-local-admin-app.md](core/06-local-admin-app.md).
- **Activity** (`/log`): what the agent decided for each client, one timeline newest first under a heading per day, repeats of one client and outcome on one day folded into one line; no sessions and no detail pane (P73, decision 0037). Its View menu's Sends view is the send history.
- **Knowledge** (`/knowledge`): every entry of the project's knowledge base under a heading per topic (P74: the folder, else the category), each with its Open: [core/16-projects-and-knowledge.md](core/16-projects-and-knowledge.md), [core/18-kb-loop.md](core/18-kb-loop.md).
- **Settings** (`/settings`): what is set rarely, one pane per question, reached by its sub-nav (P75). Sending: Stop sending, who drafts may go to, autosend. Checks: the safety rules that block or warn before Send. Mail: the project's accounts and filters ([core/17-mail-filters.md](core/17-mail-filters.md)). Agent: per CLI the model, the advisor (Claude Code), the attached connectors and the tool checks. Connections: the Notion token, write-only (the Telegram bot's token is on Messengers ▸ Settings). This Mac: start after a restart and the core version.
- **Help** (`/help`): what to say to the agent, the tips for each CLI, where the project's files live, and "How it works": the main blocks below in five lanes and three cuts, drawn by Mermaid from the fixed model `@hub/contract/scheme-model` and coloured by the live parts Overview reads (P81, decision 0042).

**The terminal dock.** A right-hand column beside every screen, always there (a strip when closed, Ctrl+`). Its tabs run `hub agent <project>`
with Claude Code or Codex, or the owner's shell. A session is attended (the CLI asks) or unattended (`agent.unattended: true`: no prompts, the
OS sandbox on); in both the send tools are denied: [core/24-terminal.md](core/24-terminal.md).

**Files dropped on the dock.** A file dragged onto a tab is copied by the server under `state/drops/<project>/<session>/`, and its path is
pasted into the session's input line. At most 10 files and 20 MiB per drop; the folder goes when the tab closes, and other projects' sessions
cannot read it: [core/24-terminal.md](core/24-terminal.md).

**Messengers.** The server receives from a Telegram bot (with `state/secrets/telegram-bot-token`), from the owner's own Telegram account
(MTProto, logged in on Messengers ▸ Settings) and from his own WhatsApp number as a linked device (Baileys, a QR code scanned there; P71 M5).
Only chats linked to a client are stored, by the owner's Link or by the autolink on an exact phone or username of one Notion client (P84);
any other chat leaves no row. The agent reads a linked chat with `messenger_history` and writes a draft row with `messenger_draft_write`,
within each chat's rules; it has no send tool. The owner reviews the draft on Messengers ▸ Chats and his Send goes through the send door
(P71 M4). An optional per-chat pre-analysis hides closing, automated and personal messages from the agent (P71 M-P, below):
[app/packages/messengers/README.md](../app/packages/messengers/README.md).

**The LLM door.** `@hub/llm` is the only code that may call a model API: typed structured calls to OpenRouter with the instance's one API key,
a ledger row per attempt in `llm_calls` and a monthly cap checked before the call. Without a key a caller says "not analysed". Its first
caller is the messenger pre-analysis (P71 M-P: a per-chat switch, off by default, that hides closing, automated and personal messages
from the agent, kept and counted); Overview shows its standing. Threads topics (P79) is next: [core/27-llm.md](core/27-llm.md).

**Capabilities.** Each session gets one generated line naming what it reaches: mail (read, unsent drafts), Notion, knowledge, the Google
Calendar and Drive connectors its project attaches in `project.md`, and the owner's browser. A connector reads and makes holds or links; it
never invites, shares or deletes. Codex sessions get no Google connectors: [core/26-capabilities.md](core/26-capabilities.md).

**The browser.** The browser is the owner's own, as he set it up: Claude Code starts with `--chrome` (his Claude in Chrome extension), and Codex
uses the extension he linked. The Hub adds no browser and the guard does not narrow it. The capabilities line says mail and messenger messages
never go out through it. Through it an agent can also act on the admin's own tab: [core/26-capabilities.md](core/26-capabilities.md), section 8.

**The agent log.** Every prompt, answer, tool call, wait on the owner and guard event of a session is written per project under `state/log/`,
from the CLIs' own hooks. It records and never decides. `hub log` reads it; the terminal strip's dot and the tones read its tail: [core/25-agent-log.md](core/25-agent-log.md). What failed underneath (a messenger's disconnect, Mail, Notion, the send door, the server) is the ops log, one redacted line each, read by `hub logs` and Overview's Recent errors: [core/28-ops-log.md](core/28-ops-log.md).

**After a restart of the Mac.** One LaunchAgent per instance runs `./run.sh up --service` at login, set up by `./run.sh setup` and switched
on Settings ▸ This Mac. It starts the server and the admin only: no agent session starts and no browser opens until the owner opens them:
[core/08-local-app-stack.md](core/08-local-app-stack.md).

**A new core.** The server reads the core's origin tags 2 minutes after start, every 6 hours, and on Check now. The sidebar's version line says
when an update is available, recommended or required, and links to Settings ▸ This Mac, which shows the instance's own update command. There
is no Update button: the owner runs the command: [core/08-local-app-stack.md](core/08-local-app-stack.md).

**Where facts live.** Client records: Notion. Draft text: Mail. Review state, marks, batches, follow-up enrolments, the messenger messages of
linked chats and the LLM ledger: SQLite. Each project's send policy: `state/projects/<slug>/send-policy.json`, written only by `hub send policy`.
Project facts, filters, knowledge, workflows and follow-up sequences: plain files in `projects/<slug>/`. Secrets: `state/secrets/`, mode 600,
never in git and never shown on a page: [core/06-local-admin-app.md](core/06-local-admin-app.md).

**Follow-ups.** A quiet client is enrolled in one of the project's follow-up sequences only on the owner's words, recorded with the enrolment.
A session drafts each due step when asked, the owner sends it, and a reply ends it: [core/23-sequences.md](core/23-sequences.md).

**Lead forms.** The instance lists its public lead forms in `config/lead-forms.json`. `hub doctor --only Leads` checks that each one still takes
a lead, and `--canary` sends a signed test lead. An agent that changes a site, a form, a CSP, a proxy or a DNS record runs it before it reports
done: [core/22-lead-forms.md](core/22-lead-forms.md), [core/21-leads.md](core/21-leads.md).

**Two layers.** Everything in this repository is **core** (universal design, code, skills, install). One owner's projects, history and secrets are
an **instance**, kept outside it and selected with `HUB_HOME`; it runs with `./run.sh`. A document goes in `core/` only if it names no specific
client, project, mailbox or person: [LAYERS.md](LAYERS.md).

## The main blocks

The blocks Help draws under "How it works", in its five lanes (`app/packages/contract/src/scheme-model.ts`, P81, decision 0042). A unit
test fails when a block of the model has no row here or its row does not link its page.

| Lane | Block | What it is | Page |
|---|---|---|---|
| In | You | The owner: a phrase to the agent, Send, Edit and Skip in the admin | [core/24-terminal.md](core/24-terminal.md) |
| In | Client mail | Apple Mail, read through `mail-mcp` | [core/02-connectors.md](core/02-connectors.md) |
| In | Messengers | Telegram and WhatsApp, linked chats only | [core/24-terminal.md](core/24-terminal.md), [messengers README](../app/packages/messengers/README.md) |
| In | Dropped files | A file dragged on a terminal tab, copied under `state/drops` | [core/24-terminal.md](core/24-terminal.md) |
| Agent | Project rules | `project.md`, the session rules, each chat's rules, the mail filters | [core/16-projects-and-knowledge.md](core/16-projects-and-knowledge.md) |
| Agent | Skills and workflows | `skills/` and the project's workflows | [core/20-workflows.md](core/20-workflows.md) |
| Agent | Agent | Claude Code or Codex in `hub agent` | [core/24-terminal.md](core/24-terminal.md) |
| Agent | Guard | Deny list, hooks, the Notion scope | [core/26-capabilities.md](core/26-capabilities.md) |
| Reads | Knowledge | The project's entries, through `hub mcp` (`knowledge_search`) | [core/16-projects-and-knowledge.md](core/16-projects-and-knowledge.md) |
| Reads | Notion CRM | The project's own databases | [core/15-notion-project-deploy-skill.md](core/15-notion-project-deploy-skill.md) |
| Reads | Calendar and Drive | The Google connectors a project attaches | [core/26-capabilities.md](core/26-capabilities.md) |
| Reads | Your browser | The owner's own extension; the Hub adds none | [core/26-capabilities.md](core/26-capabilities.md) |
| Hub | Hub tools | `hub mcp`: drafts, focus, highlight, messengers | [core/24-terminal.md](core/24-terminal.md) |
| Hub | Server and app.db | The local API and its database | [core/08-local-app-stack.md](core/08-local-app-stack.md) |
| Hub | Agent log | Every turn of a session | [core/25-agent-log.md](core/25-agent-log.md) |
| Hub | Admin | The seven sections and the terminal dock | [core/06-local-admin-app.md](core/06-local-admin-app.md) |
| Hub | LLM | `@hub/llm`, cheap typed calls | [core/27-llm.md](core/27-llm.md) |
| Out | Send policy and checks | Who a draft may go to, the checks before Send | [core/14-bulk-send-interface.md](core/14-bulk-send-interface.md) |
| Out | Send door | One draft, after the owner's Send | [core/14-bulk-send-interface.md](core/14-bulk-send-interface.md) |
| Out | The client | A reply by mail or chat | [core/02-connectors.md](core/02-connectors.md) |

## How the parts talk

**Owner, admin, server, database.** The owner acts only in the admin; the admin calls only the server over `/api`; the server and the `hub`
commands write `data/app.db`. Triggers on every table record each write in a counter, the server sends one small frame naming what changed on
`GET /api/live`, and the admin reads that part again, so a draft shows within about a second. One browser tab holds the stream for the others;
while it is down the admin polls: [core/06-local-admin-app.md](core/06-local-admin-app.md), Live updates.

**Dock agent and panel.** The admin posts what it shows (the open draft, its client, the selected rows, the view) to `POST /api/focus`. The
session reads it with the `focus` tool of `hub mcp` and a `[Hub focus, data]` line the hub adds to each prompt, so "this client" means the
draft on screen; the dock's header says "Agent sees: draft N". When the agent writes a Mail draft, the hub bumps the `mail` topic and the
open card reloads. Every row carries a ref (`draft:42`, `knowledge:<path>`), so "this" is the row he clicked or arrowed to; the agent's
`highlight` draws a ring on up to five rows for 30 s and never clicks or navigates for him (P72, decision 0038): [core/24-terminal.md](core/24-terminal.md), Shared focus.

**Agent and the outside.** Mail: read through `mail-mcp`, drafts written by `draft_write` through Mail's own scripting, with Mail in the
background ([core/02-connectors.md](core/02-connectors.md)). Notion: the session's own connector, no token in the Hub; an optional integration
token serves dumps, backups and the doctor. Google Calendar and Drive: connectors attached per project ([core/26-capabilities.md](core/26-capabilities.md),
[core/19-calendar.md](core/19-calendar.md)). Messengers: the two `hub mcp` tools, over the database only. The web and Notion pages: the owner's browser.

**What a session is given.** At start `hub agent` links the core skills into the instance's `.claude/skills` (and the Codex home), and writes
the session's MCP servers. The system prompt gets the core's session rules (`sessionRules()`), the project's own mail identity and the
capabilities line. Deny rules and the `hub guard` hook keep the session draft-only and inside its project. A project's workflows
(`projects/<slug>/workflows/`) are playbooks the agent picks by description or runs when the owner names one ([core/20-workflows.md](core/20-workflows.md)).

**The one send door.** Mail leaves only through the server's `POST /api/projects/:slug/drafts/:id/send` (or `hub send` by a person): a dry run
shows the exact mail, the apply needs a single-use ticket only the admin page can mint, and `@hub/send` re-checks recipients, the send policy,
Stop sending and the safety rules. Autosend is off unless a project's send policy turns it on for listed mail classes; it uses the same checks
and the same door. Messenger drafts of the owner's Telegram account and WhatsApp number go through `POST /api/projects/:slug/messengers/drafts/:id/send` with their own guards (P71 M4, M5: an inbound message first, 30 a day and 20 s apart per account, `telegram:<id>` or `whatsapp:+<number>` in `allow_list` in test mode, Stop sending), one at a time by the owner's click, never automatically:
[core/16-projects-and-knowledge.md](core/16-projects-and-knowledge.md), section 3B.

**The guards.** No agent session has a send tool. Both servers bind to loopback and refuse a foreign Host or Origin. The send ticket, the
terminal's socket, its drops and the shared focus accept only the admin's exact Origin. No page shows a key.

The index of every document is [../README.md](../README.md#where-things-are); which credential goes to what is [setup/access.md](setup/access.md); starting an instance and joining one as a teammate is [setup/team.md](setup/team.md);
the working-order checklist is [setup/checklist.md](setup/checklist.md); frontend rules for the admin are [../app/@rules/README.md](../app/@rules/README.md).

Update this page when the architecture changes.
