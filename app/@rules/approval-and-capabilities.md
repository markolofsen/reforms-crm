# Approval and capability boundaries

Scope: safety: dispatch, agent sessions and every door that writes Hub state or delivers a message (headline: `README.md` rule 3). History: decision 0047.

## Rules

1. MUST: `approval_policy=never` is an unattended dispatch mode, not a bypass: it runs only the allow-listed `mcp__hub__draft_write`, which still passes project scope, schema, draft-only and server checks.
2. MUST: unattended and attended modes share one deny list, with one exception (decision 0046): `mcp__hub__messenger_send` is denied in unattended mode only. Every other send, adapter call, `HumanActor` and ticket is denied in every mode.
3. MUST: `hub.draft_write`, `hub.client_record` and `hub.messenger_draft_write` never send, never write a `send_log` row and never construct a `HumanActor`.
4. MUST: attended mode keeps `on-request` approval; no bypass flag or policy rewrite, ever.
5. MUST: unknown tools, unknown modes, a missing project scope and cross-project ids fail closed before a Hub tool runs.
6. MUST: background jobs and inbound handlers cannot mint an owner actor or call a delivery adapter. There is no automatic messenger reply mode; one needs a new decision record first (decision 0003), never a setting.
7. MUST (decision 0046, amends decision 0003 and 0045 point 1): in an attended session the agent may send ONE messenger draft on the owner's word, through `mcp__hub__messenger_send` (the chat and the draft id, nothing else). The server, not the tool, verifies the word in the project's session log: an owner `prompt` that tells it to send ("отправь", "send it"), written after the draft's last change, the newest prompt of its session, at most 12 hours old, not negated, and naming the chat unambiguously. It then calls the same door as the owner's Send button (`applyMessenger`), with `actor: agent_on_owner_word` and the word's log reference on the `send_log` row; a reference is unique: one send per word. Every refusal carries a code and the next step; the agent never retries a refused or failed send.
8. MUST: Mail is never sent by the agent, in any mode: there is no Mail send tool, and the agent send route refuses anything but a messenger draft. An email is sent only by the owner's click in the admin (decision 0046 point 4).
9. MUST: the agent send route answers only the hub MCP server (a token under `state/secrets`, which every session is denied), refuses outright when the instance is unattended, and never takes the owner's words or a session id from its caller as proof.
10. MUST: a person's send is one draft at a time, after the exact text was shown and confirmed, through the one door: `POST /api/projects/:slug/drafts/:id/send` for Mail and `.../messengers/drafts/:id/send` for a messenger draft (`apps/server/src/send/sends-routes.ts`, checks in `@hub/send`): a dry run, a ticket, the `send_log` row first, one send, no retry.
11. MUST: the one bulk send is Send all Checked of one batch (decision 0011 amendment of 2026-11-20): a dry run of every Checked draft, one confirmation naming the count and each recipient, a ticket bound to those draft ids and text hashes, then one draft at a time on the server with every guard, its own cap and spacing, and Stop between two mails. Nothing sends on a timer or in bulk otherwise.
12. MUST: a messenger send passes its own guards (`packages/messengers/src/door.ts`): an inbound message in the chat, the daily cap and spacing per account, `draft.recipients: test` admitting only allow-listed ids, and Stop sending.
13. MUST: the admin's other Mail writes are a person's Save and Restore of one draft and Tidy; the Hub removes only Mail drafts its own record says it wrote (`mail_versions`, by account and Message-ID; decision 0031), to Trash, never permanently.
14. MUST: tests and e2e use the fake Mailer only (`HUB_MAILER=fake`, refused without `HUB_DB`).

## Enforcement

| Rule | Check |
|---|---|
| 1-6 | dispatcher policy tests (unattended, attended, unknown tool, cross-project); `apps/server/test/draft-only.test.ts` |
| 2 | `packages/agent/test/deny-modes.test.ts`; `apps/installer/test/safety.test.ts` |
| 4-5 | installer safety tests; review of the dispatcher |
| 7 | `packages/agent/test/owner-word.test.ts`; `apps/server/test/agent-send.test.ts` |
| 8 | `apps/server/test/agent-send.test.ts`; `packages/agent/test/registry.test.ts` (no Mail send tool; absent unattended) |
| 9 | `apps/server/test/agent-send.test.ts` |
| 10-11 | `test/send-boundary.test.ts`; `apps/server/test/batch-send.test.ts`; `apps/server/test/draft-only.test.ts` (the door is the only caller of the senders) |
| 12 | `apps/server/test/messenger-send.test.ts`, `apps/server/test/whatsapp-send.test.ts` |
| 13 | `apps/server/test/draft-mail.test.ts`; review |
| 14 | `apps/server/test/send.test.ts` |

Update this page whenever a tool permission, approval mode or delivery door changes.
