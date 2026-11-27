# Reviewed public replies

Decision 0061 adds an explicit public-group target to the messenger send door. An external operator or SMM workflow supplies a reviewed proposal. CRM does not generate text, start a marketing timer, or send because a public message arrived.

## Scope and evidence

The initial capability sends one plain-text reply in an explicitly granted public group or supergroup. It has no media, paid messages, send-as identity, private-chat fallback or implicit broadcast-channel comment target. A channel's linked discussion group must first be selected and granted as its own public source.

The source must still be readable, text-bearing, not the account's own message, and no older than 48 hours. A review expires after 30 minutes. Source, actual reply/topic target, group description and latest pinned message are fingerprinted. The provider snapshot explicitly says `latestPinOnly: true`: it is not a claim that every pinned or external community rule was retrieved. The reviewer attests that the intended response satisfies the applicable rules and strategy.

The signed-in account must be a member. Fresh provider checks read its own membership and send-text restrictions, defaults and slow-mode date. Deleted source messages, changed text/topic/rules, changed policy/strategy, a disabled direction, disconnected account or Stop sending refuse delivery.

## Protected owner grant

The effective file is `hubPaths().stateProjects/<project>/watch-policy.json`. Editable project content cannot grant a send. The supported owner CLI validates a candidate JSON, its contained project-relative strategy digest and the next integer revision:

```sh
hub watch policy show --project acme
hub watch policy set --project acme --file /absolute/path/reviewed-watch-policy.json
```

Initial revision is 1; each replacement must be exactly the current revision plus 1. The file has this shape:

```json
{
  "version": 1,
  "revision": 1,
  "enabled": true,
  "account": "123456",
  "approval": {
    "requestRef": "actual-owner-request-reference",
    "approvedAt": "2026-11-27T10:00:00.000Z"
  },
  "directions": {
    "support": {
      "groups": ["acme_chat"],
      "join": true,
      "reply": true,
      "strategy": {
        "path": "workflows/support/strategy.md",
        "sha256": "<64 lowercase hexadecimal digits of the strategy file>"
      }
    }
  },
  "limits": { "joinsPerDay": 3, "repliesPerDay": 3 }
}
```

For a join-only grant use `reply: false` and omit `strategy`. Set `enabled: false` at the next revision to revoke it; revocation works even if the strategy has since changed. Account ids must be actual configured Telegram user account ids, not `default`. Group usernames are lowercase.

The command writes an audited prepared intent, atomically replaces the effective file, then records applied status. The effective file's generation resolves a crash between these steps. It does not alter the default private messenger send policy. Existing Hub agent-session restrictions are enforced; the CLI never clears environment flags to acquire permission. Neither a `HumanActor` nor an owner-word session-log proof is fabricated.

## Review, propose and explicitly send

Read the exact provider snapshot first; this does not join, send or mark history read:

```sh
hub watch reply context --project acme --direction support --group acme_chat --message 42
```

The result contains source/rules hashes, policy generation, strategy digest, current permissions and bounded rule evidence. Review the actual discussion and applicable community rules, then create a local JSON input:

```json
{
  "direction": "support",
  "group": "acme_chat",
  "messageId": 42,
  "text": "The exact reviewed reply.",
  "sourceHash": "<hash returned by context>",
  "rulesHash": "<hash returned by context>",
  "review": {
    "ref": "review-report-or-external-workflow-reference",
    "at": "2026-11-27T10:05:00.000Z",
    "rulesAccepted": true
  }
}
```

```sh
hub watch reply propose --project acme --file /absolute/path/reviewed-reply.json
hub watch reply show --project acme --proposal <proposal-id>
hub watch reply send --project acme --proposal <proposal-id> --text-hash <textHash-from-proposal>
```

Propose only stores an immutable row. Send verifies the exact reviewed hash and freshly rechecks the source, permissions and grant before inserting `send_log`, then invokes the guarded adapter once. The whole provider check/audit/send runs inside the canonical account queue; it cannot wait behind another join after its audit. The same connection's owner-busy counter and durable FloodWait park apply. SMM owns content review, source selection and scheduling outside this capability.

The public authority is the tagged `watch_review` member of `MessengerAuthority`. It uses the same internal authorization mint, project lifecycle/recipient guard, Stop controls, 30-per-day physical account cap and 20-second spacing as private sends. The protected reply cap additionally limits all `watch_review` attempts on that account over 24 hours. Public proposals and send audit live in the same `app.db`; claiming the attempt and reserving the stable account/peer/reply-message target is one transaction. Direction or analysis-window changes cannot duplicate that target. No private Messenger draft, author-as-client or fake chat is created.

## Receipt and unresolved delivery

The adapter passes numeric same-chat reply/topic ids and a persistent random id, requires the reply target to exist, then reads the saved provider message. Only matching outgoing peer/reply/topic/text data is a receipt.

A timeout, crash, mismatched receipt or ambiguous provider failure leaves the attempt `sending`, explicitly unresolved. That durable row keeps its target and quota reservation. The SDK may do peer reads after the send RPC, so a read-side 4xx or FloodWait is not treated as proof that no message left. Only specific send-rejection errors are final failures. Nothing automatically retries. On CLI timeout or an uncertain response, inspect the stored proposal; do not create a new proposal to evade the reserved target.

```sh
hub watch reply show --project acme --proposal <proposal-id>
hub watch reply reconcile --project acme --proposal <proposal-id> --message <observed-provider-message-id>
```

If the send already returned a provider id, `--message` may be omitted. Reconcile only reads an exact outgoing provider message and records a matching receipt; it never sends. A missing or mismatching message leaves delivery unresolved.

## API ownership

The five `/api/projects/:slug/watch/actions/...` routes are a supported local CLI surface, require the local action token, and do not generate a browser client. `@hub/contract/watch-actions` owns request/reply schemas; `composition/operations.ts:NOT_DECLARED` records their explicit exclusion from browser OpenAPI; `@hub/api/ledger:LOCAL_CLI_WATCH_ACTIONS` names their purposes. Only `send/watch-actions.ts` calls the staged public door. The read/join adapter and watcher retain no send capability.
