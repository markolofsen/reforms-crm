# `@hub/api`

The generated JSON API boundary for the Hub admin app.

```sh
pnpm --filter @hub/api generate
```

`openapi.json` is Orval's one input, emitted by the server (`pnpm --filter @hub/server openapi`, run first by `generate`)
from its declared operations and their `@hub/contract` schemas, over the hand-kept `openapi.base.json` for the
domains not declared yet (P120 W1: instance; W2 deletes the base).
`src/generated` and `src/generated-zod` are Orval output and must not be edited
by hand. They have no deep package export. `src/runtime` owns same-origin
credentials and Hub error normalization.

`src/ledger.ts` (`@hub/api/ledger`) is the endpoint ledger: every operation of
`openapi.json` by domain, and every path an admin facade still calls raw with
the reason it stays raw (credentials, a lifecycle protocol, a local bridge, a
stream or a send door). `apps/admin/test/rules.test.ts` fails when the spec,
the barrel and the ledger disagree.

The generated Messenger manual-draft operation deliberately persists only
bounded owner text and never calls a provider. Editing, preparing, approval and
sending remain separate product-owned actions.

This package is a transport boundary, not a React Query package. Admin features
use only the public exports through a domain facade; the facade supplies the
explicit project scope, validates the response with generated Zod, maps it to a
domain view model, and preserves the admin `ApiFailure` contract. The generated
client never reads route state, cookies, React context or a mutable project
singleton, and it never owns cache invalidation or send permissions.

React Query remains in the admin app. Feature facades migrate one route group
at a time; streams, terminal sessions, file uploads, local bridges, MCP and
send authorization stay outside this generated JSON package.
