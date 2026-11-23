# Approval and capability boundaries

Scope: MCP dispatch, agent sessions and every route or adapter that can write
Hub state or deliver a message. This page complements `agent-guardrails.md`;
it does not grant a capability that a route, tool or send-door does not expose.

## Rules

1. MUST: `approval_policy=never` is an unattended dispatch mode, not a bypass.
The dispatcher may execute only an explicitly allow-listed safe operation:
`mcp__hub__draft_write` for an unsent Mail draft. The operation must still
pass project scope, schema, draft-only and server policy checks.
2. MUST: unattended and attended modes share the same deny list, with one
exception (decision 0046): `mcp__hub__messenger_send` is denied in unattended
mode only. Mail send, batch send, adapter calls, HumanActor creation,
approval-ticket minting and unknown tools are denied in every mode unless the
existing attended owner flow explicitly owns them.
3. MUST: `hub.draft_write`, `hub.client_record` and `hub.messenger_draft_write`
never send, never create a send-log row and never construct a `HumanActor`.
Their success means only that an unsent draft (or, for `client_record`, one
Inbox row of a client handled without a draft, P129 A3) was recorded or saved
through the existing writer. `client_record` is a `draft`-effect tool: in
unattended Codex it runs only once P112's capability matrix admits it.
4. MUST: attended mode keeps `on-request` for operations that need owner
approval. Do not turn a safe unattended exception into a global auto-approve
rule, and do not use `yolo`, `dangerously-bypass`, sandbox weakening or an
approval-policy rewrite as a fallback.
5. MUST: unknown tool names, unknown modes, missing project scope and
cross-project identifiers fail closed before the Hub tool is invoked.
6. MUST: background jobs and inbound event handlers cannot mint an owner
actor or call a delivery adapter. There is no automatic Messenger reply mode:
`messengers.response_mode` and `messengers.reply_provider` were deleted (P119,
owner 2026-11-23); an automatic mode needs a new decision record first
(decision 0003, P112), never a setting or a test edit. Level B2 ("chats you
allow") is such a mode and is not decided.
7. MUST (decision 0046, amends decision 0003 and 0045 point 1): in an attended
session the agent may send ONE messenger draft on the owner's word, through
`mcp__hub__messenger_send` (the chat and the draft id, nothing else). The
server, not the tool, verifies the word in the project's session log (P54,
P129 verdict 7): an owner `prompt` that tells it to send ("отправь", "send
it"), written after the draft's last change, the newest prompt of its session,
at most 12 hours old, not negated, and naming the chat unambiguously (the
chat's ref in the prompt or the same turn's focus line, else the only open
draft changed since the session's previous prompt). It then calls the same
door as the owner's Send button (`applyMessenger`: an inbound first, Stop
sending, the daily cap and spacing, `draft.recipients`), with `actor:
agent_on_owner_word` and the word's log reference on the `send_log` row. A
reference is unique on `send_log`: one send per word. Every refusal carries a
code and the next step; the agent never retries a refused or failed send.
8. MUST: Mail is never sent by the agent, in any mode: there is no Mail send
tool, and the agent send route refuses anything but a messenger draft. An
email is sent only by the owner's click in the admin (decision 0046 point 4).
9. MUST: the agent send route answers only the hub MCP server (a token under
`state/secrets`, which every session is denied), refuses outright when the
instance is unattended, and never takes the owner's words or a session id
from its caller as proof. Doubt, recorded: an attended agent may write files
after the owner approves a prompt, so the session log is not tamper-proof;
the owner's approval prompt, the token and the per-word reference are the
belts.
## Enforcement

| Rule | Tool |
|---|---|
| 1-6 | P112 safety tests and dispatcher policy tests for unattended, attended, unknown tool and cross-project cases |
| 2-3, 6 | `apps/server/test/draft-only.test.ts`, Messenger draft/send-boundary tests and final `verification.md` gate |
| 2 | `packages/agent/test/deny-modes.test.ts` (the deny list, `claudeDisallowed` and Codex `disabled_tools` per mode); `apps/installer/test/safety.test.ts` (`hub guard` blocks `messenger_send` unattended, passes it attended) |
| 4-5 | installer/config safety tests and review of the approval dispatcher; no bypass flags are permitted |
| 7 | `packages/agent/test/owner-word.test.ts` (the word: after the draft, newest of its session, negations, the chat), `apps/server/test/agent-send.test.ts` (owner word sends once; no word, a word before the draft, another chat, a second call refused; Activity says "Agent (your word)"), `draft-only.test.ts` (the door is the only caller of the senders) |
| 8 | `apps/server/test/agent-send.test.ts` (a Mail draft id is refused), `packages/agent/test/messenger-send-tool.test.ts` (no Mail send tool; the tool is absent unattended) |
| 9 | `apps/server/test/agent-send.test.ts` (no token, a wrong token, an unattended instance) |

Update this page whenever a tool permission, approval mode or delivery door
changes.
