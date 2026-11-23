# `@hub/api`

The generated JSON API boundary for the Hub admin app.

```sh
pnpm --filter @hub/api generate
```

`openapi.json` is Orval's one input, emitted by the server (`pnpm --filter @hub/server openapi`, run first by `generate`)
from its declared operations (`apps/server/src/<domain>/openapi.ts`) and their `@hub/contract` schemas; nothing is
kept by hand (P120 W2). `src/generated` is Orval output and must not be edited by hand; it has no deep package
export. `src/runtime` owns same-origin credentials and Hub error normalization.

`src/ledger.ts` (`@hub/api/ledger`) is the endpoint ledger: every operation of `openapi.json` by domain, the
operations reached only by their URL helper (a stream, a file, a multipart form, a keepalive beacon) and the doors
with the one facade that may import each. `apps/admin/test/rules.test.ts` fails when the spec, the barrel and the
ledger disagree, when an admin module writes an `/api/` path, or when a door is imported elsewhere.

The generated Messenger manual-draft operation deliberately persists only
bounded owner text and never calls a provider. Editing, preparing, approval and
sending remain separate product-owned actions.

This package is a transport boundary, not a React Query package. Admin features
use only the public exports through a domain facade; the facade supplies the
explicit project scope, validates the response with the contract schema, maps it to a
domain view model, and preserves the admin `ApiFailure` contract. The generated
client never reads route state, cookies, React context or a mutable project
singleton, and it never owns cache invalidation or send permissions.

React Query remains in the admin app. Streams, terminal sessions, file uploads,
local bridges, MCP and send authorization keep their own owners: their JSON
calls are declared operations, but the facade owns the lifecycle and the door.
