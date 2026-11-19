# 02. Connectors for the mail agent

Manual-first: the owner starts a session (`hub agent` or Claude Desktop) and gives ONE instruction (`skills/README.md`). Nothing runs in the background.

An agent session reads local Mail.app, follows a SKILL.md,
drafts replies, reports into Notion. No Hub Django or frontend. (local) = read on this Mac;
(est.) = my estimate, not measured.

## Who reaches what
- **Agents reach services through their own connectors.** A session (Claude Code, Codex, Claude Desktop) reads mail through `mail-mcp` (Apple Mail), writes unsent reply drafts through the hub MCP server's `draft_write` (P52, decision 0030 of the plan repo) and writes the CRM through its Notion connector (MCP). The hub never proxies these and holds no login for them.
- **The hub gives agents local tools:** `hub record-draft` and `hub record-client` (what the session did, into the database), `hub sequences` (follow-ups), the knowledge MCP over the project's files, and the guard (deny rules and the PreToolUse hook that keep a session draft-only and inside its project).
- **The admin shows the state** those tools leave, and holds the owner's decisions; its one door out is the confirmed send through Apple Mail (`osascript`). Mail has no other path: no IMAP, no mail key in the hub (decision 0026).

## Recommended stack
| Layer | Choice | Why |
|---|---|---|
| Mail | `mail-mcp` (dastrobu) 0.5.0, installed, HTTP daemon :8787, read only for the agent; drafts: `hub mcp` `draft_write` | No send tool: draft-only by construction |
| Notion | Official hosted Notion MCP (`mcp.notion.com/mcp`); sign in once with `/mcp` (access: `@docs/setup/access.md`) | Maintained by Notion |

## 1. Mail connectors
| Server | Maintainer, activity | Install | Permissions | Threads | Send |
|---|---|---|---|---|---|
| dastrobu/mail-mcp (installed) | one person, 5 stars, 135 commits, no releases listed | `brew install dastrobu/tap/mail-mcp` | Automation (binary), Accessibility (drafts) | none | none |
| patrickfreyer/apple-mail-mcp | one person, 256 stars, 231 commits, MIT | `claude plugin install apple-mail@apple-mail-mcp`, or `uvx mcp-apple-mail` | Automation, Mail Data Access | `get_email_thread` | yes; `--read-only` blocks it |
| Gmail MCP (GongRzhe) | ~1.1k stars, archived 2026-03-03; fork ArtyMcLabin on the MCP registry | npx + Google OAuth | Gmail OAuth | Gmail threads | yes |
| claude.ai Gmail connector (here) | Anthropic-hosted | connected | OAuth | `get_thread` | `send_message` |

Installed mail-mcp, from its local schemas and README:
- Tools: `list_accounts`, `list_mailboxes`, `find_messages`, `get_message_content`,
  `get_selected_messages`, `create_reply`, `replace_reply`, `create_outgoing_message`,
  `replace_outgoing_message`, `delete_outgoing_message`, `list_outgoing_messages`, `list_drafts`, `delete_draft`.
- `find_messages`: account + mailboxPath + one filter (sender, subject, `readStatus`, `flaggedOnly`,
  date range), limit up to 1000, substring match.
- `get_message_content`: body, headers, recipients, attachment name/size/status (no MIME type, no download).
  Ids are integers per mailbox, not global.
- No threads: rebuild by normalised subject + sender over Inbox and Sent. Whether headers carry
  Message-ID / In-Reply-To is unverified.
- Read flag: filterable, not settable. Our state file is the queue, not "unread".
- `create_reply` (and every mail-mcp write) opens a compose window, activates Mail and pastes with a global Cmd+V
  through Accessibility. With another app in front macOS keeps Mail in the background: the paste never lands and an
  empty reply is left (P51 live check, 2026-11-18). No release or flag changes it (0.5.0 is the latest). So the agent's
  mail-mcp is read only: `create_reply`, `replace_reply`, the outgoing-message tools and `delete_draft` are denied.
- Drafts are written by `hub mcp` `draft_write` (`@hub/agent/mail-drafts`): Mail's own `reply ... opening window false`,
  `content`, `save`, from the hub's process (outside the agent's sandbox), Mail in the background, the thread headers
  kept, plain text with the `[hub-draft thread=...]` line added. A revision deletes only the older drafts of the same
  account, subject and marker, after the new one is found. A revision names only the hub draft (`draft`); the hub finds
  the answered message by its Message-ID (the draft's `mailRef`) and bumps the live topic `mail`, so the open admin card
  reads the new text (P53). Mail.app must be running; nothing is sent.

Verdict: draft-only is structural; costs are no threads, no read-marking, GUI dependency. patrickfreyer has
threads but can send: `--read-only` only, never both.

## 2. Notion MCP
- Official hosted server (OAuth via the client).
- Limits (official request-limits page): 600 requests/min per connection on Business/Enterprise,
  180/min (about 3/s) on other plans; data-source queries about 3/s separately. Every MCP call counts.
  MCP retries a 429 once if the wait is 2 s or less, else returns `rate_limited` with `retry_after_seconds`.
  Our load (3-6 calls per active run) is far below.
- Per-request size: 2000 chars per rich-text object, 100 array elements, 1000 blocks, 500 KB.
- Enrichment: `notion-search` / `notion-query-data-sources` to find the client by email,
  `notion-update-page` for properties and appended content, `notion-create-comment` as a lighter log.
  Append dated entries; never rewrite the profile body.

## Sources
- https://github.com/dastrobu/mail-mcp
- https://github.com/patrickfreyer/apple-mail-mcp
- https://github.com/GongRzhe/Gmail-MCP-Server
- https://developers.notion.com/guides/mcp/rate-limits
- https://developers.notion.com/reference/request-limits

Update this page when the architecture changes.
