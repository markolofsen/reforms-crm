# Approval and capability boundaries

Scope: MCP dispatch, agent sessions and every route or adapter that can write
Hub state or deliver a message. This page complements `agent-guardrails.md`;
it does not grant a capability that a route, tool or send-door does not expose.

## Rules

1. MUST: `approval_policy=never` is an unattended dispatch mode, not a bypass.
The dispatcher may execute only an explicitly allow-listed safe operation:
`mcp__hub__draft_write` for an unsent Mail draft. The operation must still
pass project scope, schema, draft-only and server policy checks.
2. MUST: unattended and attended modes share the same deny list. Messenger
send, Mail send, batch send, adapter calls, HumanActor creation, approval-ticket
minting and unknown tools are denied unless the existing attended owner flow
explicitly owns them.
3. MUST: `hub.draft_write` never sends, never creates a send-log row and never
constructs a `HumanActor`. Its success means only that an unsent draft was
recorded or saved through the existing draft writer.
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
(decision 0003, P112), never a setting or a test edit.

## Enforcement

| Rule | Tool |
|---|---|
| 1-6 | P112 safety tests and dispatcher policy tests for unattended, attended, unknown tool and cross-project cases |
| 2-3, 6 | `apps/server/src/draft-only.test.ts`, Messenger draft/send-boundary tests and final `verification.md` gate |
| 4-5 | installer/config safety tests and review of the approval dispatcher; no bypass flags are permitted |

Update this page whenever a tool permission, approval mode or delivery door
changes.
