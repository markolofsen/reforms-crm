# 26. Capabilities: what a project's session can reach (mail, Notion, knowledge, Calendar, Drive)

Status: built (P62, 2026-11-20): Calendar and Drive connectors per project, Claude Code sessions. Gmail as a connector is not built (the
mail half of P62 waits for measurements); mail stays `mail-mcp` plus the hub's `draft_write` (decisions 0026, 0030, 0011).

Every session of `hub agent <slug>` is told, in one generated line after the project's identity, what it can reach: the **capabilities
line** (`sessionCapabilities()` in `app/packages/agent/src/connectors.ts`). It is built by the same resolver that writes the session's MCP
file, so it never names a tool the session lacks. Read this page for how to use each one; the skills point here.

## 1. What a session reaches

| Capability | Through | May | Never |
|---|---|---|---|
| mail | `mail-mcp` (read), `hub` `draft_write` | read the project's accounts; write unsent reply drafts | send, forward, delete, a Gmail draft |
| notion | the `notion` server | read and update the project's CRM databases | delete or move a page, a CRM-synced field |
| knowledge | `knowledge-mcp` | search and read `knowledge/files/` | state a fact from anywhere else |
| calendar | the attached `gcal-<label>` connector | read the project's calendar; a hold with no guests (`calendar` skill) | invite, notify, delete, answer an invitation |
| drive | the attached `gdrive-<label>` connector | search, read, link a folder or file onto the client's Notion profile | share, copy, create, update or trash a file, change a permission |

A capability the line calls "none attached" is not reachable in this session: the agent says so and never looks for another way (Chrome, a
script, the owner's claude.ai connectors).

## 2. Connectors

A **connector** is a Google-hosted MCP server under a hub name, one Google account each:

| Kind | Hub name | Endpoint | Allowed tools |
|---|---|---|---|
| Calendar | `gcal-<label>` | `https://calendarmcp.googleapis.com/mcp/v1` | `list_calendars`, `list_events`, `get_event`, `search_events`, `suggest_time`; holds: `create_event`, `update_event` |
| Drive | `gdrive-<label>` | `https://drivemcp.googleapis.com/mcp/v1` | `search_files`, `list_recent_files`, `get_file_metadata`, `read_file_content`, `download_file_content`, `get_file_permissions` (and the claude.ai names `list_file_revisions`, `list_shared_drives`, `get_shared_drive_metadata`) |

- **Where it lives.** An entry of the instance's `config/mcp.json`, merged into `.mcp.json` (`hub connectors add`): `{ "type": "http",
  "url": <endpoint>, "oauth": { "clientId": <the owner's OAuth client id>, "callbackPort": <optional> } }`. No secret is in either file:
  Google's servers take no dynamic client registration, so the owner's Google Cloud project has an OAuth client, and Claude Code keeps its
  secret when the owner signs in (`/mcp`).
- **Attached per project, from any Google account** (owner, 2026-11-19): `calendar.connector` and `drive.connector` in `project.md` name the
  connectors this project's sessions may use (lists allowed). A connector is not bound to the project's mailboxes. A connector no project lists
  is used by no session (an info row). One session gets exactly its own project's connectors, never another's.
- **The account.** `state/connectors.json` holds what the hub knows of each connector's Google account: `stated` by the owner (`hub connectors
  add --account`, `hub connectors account <name> <address>`) or read by a session (`session`: its `list_calendars` names the primary
  calendar, which is the account; the guard's post hook records it). The hub holds no Google login and never calls a connector itself.
- **Claude Code only.** Codex 0.146 cannot give a server a pre-registered OAuth client, so a Codex session gets no connector and its line says so.
- **Not used:** the owner's claude.ai connectors (Calendar, Drive, Gmail in his Claude account). Hub sessions run with `--strict-mcp-config`,
  which drops them; they keep working in his own Claude Desktop. Dropping strict mode would bring every server of his into every project.

## 3. The guard

Three layers, as for mail (`24-terminal.md`): every known tool of an attached connector that is not on its allowlist is denied by exact name
(Claude's deny rules and `--disallowedTools`); the PreToolUse guard refuses any `mcp__<connector>__*` call off the allowlist; and it checks
the arguments. **Connector refusals block in every mode**, whatever `HUB_GUARD` says, because a connector write leaves the Mac.

- A hold (`create_event`, `update_event`): no `attendees` (or the deprecated `attendeeEmails`), no `addGoogleMeetUrl` or `googleMeetUrl`, no
  `guestPermissions`, `notificationLevel` absent or `NONE`; `calendarId` absent, `primary`, or `calendar.id`. An invitation is the owner's,
  by hand, from his own calendar.
- A Drive search with `drive.folder` set must name one of the folder ids in its query (`'<id>' in parents`). A read by file id cannot be
  checked against a folder: the skills keep to the project's folders, and that part is a prompt rule.
- A call to a connector this project does not attach is refused.

## 4. The link operation (Drive item or calendar event onto the client's profile)

`skills/triage-mail/references/link.md`, used by `triage-mail` and `calendar`: resolve the item through the connector
(`get_file_metadata`, `get_event`: id, name, link; never `share_file`, never a permission change), then one write with the session's Notion
writer. A folder → Clients `Drive folder` (url; replacing a different value needs the owner's "да"). A file → one Documents row (`Document`,
`Document link`, `Type`, `Clients`), never a duplicate of the same link. A calendar event → the dated line `Next call: <date> <zone>, <url>`
on the client's page body (doc 19). Never `Follow-up on` (CRM-synced). Drive content is not knowledge: a fact read there reaches a draft as
a fact only after `kb-review` copies it into `knowledge/files/` (doc 16).

## 5. Calendar help

Offered, never automatic (doc 19's rules): `triage-mail` offers a hold for a stated deadline or a proposed time (`skills/calendar/references/from-mail.md`),
`sequence-drafts` offers one `Follow-up: <client>` hold per enrolled client on the step's due date; only the `calendar` skill creates it,
after a dry run and the owner's "да" (or `calendar.auto_hold: yes` for a clean new hold), with the marker `[hub-event project=<slug>]`. The
hub's own dates (a sequence's `next_due`) stay the truth; a hold is a reminder the hub never moves. A support kind (no calendar module) offers nothing.

## 6. Checks (Settings ▸ Agent, `hub doctor --only Agent`)

Settings ▸ Agent shows one line per attached connector under **Connectors** (service, name, account, what the session may do), or "None
attached" with the phrase. Its **Checks** hold the rows, per connector: `connector.present.<name>` (in the session's MCP file),
`connector.answers.<name>` (Google's endpoint answers; an unauthorised answer counts, since each session signs in itself),
`connector.account.<name>` (a look until a session read it or the owner stated it; fix `/mcp`), `connector.tools-off.<name>` (fails when a
write is not denied). `connector.attach.<name>` fails for a listed connector the session cannot get (not in the MCP config, the wrong
endpoint, a calendar on a kind with no calendar module). Info, folded: `connector.unattached.<name>`, `connector.codex.<name>`,
`connector.claude-ai`.

## 7. Setting one up (the owner)

1. Google Cloud (the project of his OAuth client): enable the service's API and its MCP API (Calendar: `calendar-json.googleapis.com` and
   `calendarmcp.googleapis.com`; Drive: `drive.googleapis.com` and `drivemcp.googleapis.com`), add the scopes to the consent screen, and
   create an OAuth client (Web application, "Use this client for an AI-powered agent").
2. `./run.sh connectors add calendar gcal-<label> --client-id <id> --account <address>` in the instance (a session is denied it).
3. Attach it: say "настрой проект <slug>" in a session (project-setup asks which connectors the project uses), or add the row by hand.
4. `./run.sh agent <slug> --prepare`, then in that project's Claude Code session type `/mcp` and sign in with that account. Then "что у меня
   на неделе": the first `list_calendars` confirms the account.

Update this page when the architecture changes.
