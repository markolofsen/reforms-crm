# 02. Connectors for the mail agent

Manual-first: the owner starts a session (`hub agent` or Claude Desktop) and gives ONE instruction (`skills/README.md`). Nothing runs in the background.

An agent session reads local Mail.app, follows a SKILL.md,
drafts replies, reports into Notion. No Hub Django or frontend. (local) = read on this Mac;
(est.) = my estimate, not measured.

## Who reaches what
- **Drawn live:** Help ▸ How it works draws this wiring from the instance's own state (mailboxes, mail-mcp, the CLIs, the Hub tools, knowledge, Notion, the Google connectors, the guard, the send door), each part with its status word; Overview lists the same parts (P63, decision 0035).
- **Agents reach services through their own connectors.** A session (Claude Code, Codex, Claude Desktop) reads mail through `mail-mcp` (Apple Mail), writes unsent reply drafts through the hub MCP server's `draft_write` (P52, decision 0030 of the plan repo) and writes the CRM through its Notion connector (MCP). The hub never proxies these and holds no login for them.
- **The hub gives agents local tools:** `hub record-draft` and `hub record-client` (what the session did, into the database), `hub sequences` (follow-ups), the knowledge MCP over the project's files, and the guard (deny rules and the PreToolUse hook that keep a session draft-only and inside its project).
- **The admin shows the state** those tools leave, and holds the owner's decisions; its one door out is the confirmed send through Apple Mail (`osascript`). Mail has no other path: no IMAP, no mail key in the hub (decision 0026).

- **Calendar and Drive (P62)** are connectors a project attaches in its `project.md` (`calendar.connector`, `drive.connector`): Google-hosted MCP servers under hub names, one Google account each, from any account, signed in inside the project's Claude Code session. What each session may do with them, the guard and the link operation: `@docs/core/26-capabilities.md`. Gmail as a connector is not used: mail stays `mail-mcp` plus `draft_write`.

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
  kept, plain text: the reply and the signature, nothing of the hub's (decision 0031: Mail's scripting has no HTML
  channel and no header element, and a line in the body reaches the client the moment anyone presses Mail.app's Send).
  The writer finds its draft as a new draft whose In-Reply-To is the answered message and whose text starts with the
  written text, in any of the project's accounts (Mail saves a draft in its From's account), and the Hub records it
  (`mail_versions`: account, Mail id, Message-ID, the hash of the text Mail returned; never the text). A slow Mail
  (P65 S5, decision 0031 addendum): every write is recorded before Mail is asked (`mail_writes`: the hash and length of
  the written text, never the text); the writer waits up to 45 s, and a draft not seen by then is `mail_slow`, not a
  failure: nothing is replaced and the agent is told not to write again. A late save, a second save of a recorded text
  or Mail's empty reply shell (by the write's recorded hash, or, without one, as one attribution line over the answered message and nothing else) is recognised and adopted as the Hub's version at the next write, at the
  card's next read (which then keeps Mail's newest version and moves the Hub's older ones to Trash) or by `hub drafts
  unmark`; a draft whose text matches nothing the Hub wrote stays the owner's.
  A revision names only the hub draft (`draft`); the hub finds the answered message by its Message-ID (the draft's
  `mailRef`), moves the older recorded version to Trash and bumps the live topic `mail`, so the open admin card reads
  the new text (P53). A new reply to a message the project already has a draft for is refused (`already_drafted`, the
  skip of a rerun), and a text that ends with the agent's own closing, in any language, or a team or brand name line is refused (`own_signoff`): the writer signs, in
  the reply's language (P65 S2). Mail.app must be running; nothing is sent.
- The hub cleans up after itself (P56, P65): who wrote a Mail draft is the hub's record, never its text. A draft is
  moved to Trash (Mail's `delete`: the account's Trash, recoverable) only when its account and Message-ID match a
  recorded version, re-checked in the script just before the delete; subject, recipient and In-Reply-To narrow the
  search and never qualify a draft. Send, Skip and Done move the draft's recorded versions to Trash; a revision
  replaces its older version; `hub drafts sweep` (dry run unless `--apply`, the owner's: denied to the agent) reads
  Mail's headers only and lists recorded versions that are older than the draft's newest or belong to a closed draft.
  The thread decides which draft the card, Checked and Send use: exactly one draft of the project's accounts that
  answers the `mailRef` and is addressed to the client, whoever last edited it; two or more refuse Send and name each,
  saying which one the hub wrote. A draft the owner writes in the same thread counts there but is in no record, so it
  is never removed. A person's Save and Restore (the newest recorded version found in Trash by its Message-ID) write
  through the same writer (`reviseDraft`, verbatim). Exactly the Mail text goes out, as Mail's own `reply` to the
  answered message, so the client's thread keeps `In-Reply-To` and `References`. Until `hub drafts unmark` (P65 S3,
  dry run unless `--apply`, the owner's) has rewritten the drafts written before 0031 in every instance, the send
  refuses a text that still holds a `[hub-draft ...]` line; it never strips it.

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
