# Generated API clients

Scope: the generated JSON API boundary in `@hub/api`, its checked OpenAPI input, the Orval configuration and artifacts, the runtime adapter, and the admin facades that migrate one route group at a time. These rules do not replace the protocol-specific rules for SSE, WebSocket, FormData, local bridges, MCP, or send authorization.

The package is a transport boundary, not a React data layer. The generated client
knows how to describe and call a JSON operation; the admin owns project scope,
domain view models, Query state, capabilities, and user-facing recovery.

## Source of truth and generated artifacts

`app/packages/api/openapi.yaml` and the matching `@hub/contract` schemas are one
contract. `orval.config.ts` produces two artifacts from that contract:

- `src/generated/` contains the fetch operations and wire models;
- `src/generated-zod/` contains runtime parsers for the generated responses.

The generated folders are build artifacts. They are committed for review but are
never hand-edited. A route, operation id, parameter, status or response change
starts at the server contract and is regenerated with the pinned Orval version.
The public barrel in `src/index.ts` is the only generated-client surface that an
admin facade may expose to the rest of the app. A feature never imports a
generated deep path merely because it is available on disk.

## Rules

1. MUST: treat the `@hub/contract` schemas plus the checked `app/packages/api/openapi.yaml` document as one contract. Do not maintain a second hand-written wire schema for the same operation. A domain type may be narrower or more useful, but it is mapped at the facade boundary.
2. MUST: generated output is never hand-edited. `app/packages/api/src/generated/` and `app/packages/api/src/generated-zod/` are replaced by `pnpm --filter @hub/api generate`; review the generated diff as an artifact of the contract change.
3. MUST: when an HTTP JSON operation is present in the checked OpenAPI document, call its generated operation through an admin API facade. Do not hand-write its path, query serialization, request body interface, response interface, or status decoding. A raw-path facade is allowed only for a route group explicitly remaining in the active generated-client migration plan.
4. MUST: consumers use the public `@hub/api`, `@hub/api/runtime`, and `@hub/api/zod` exports. Feature components never import generated deep paths, generated operation functions, generated Zod schemas, cache keys, or the configured transport directly.
5. MUST: `@hub/api/runtime` owns same-origin credentials, headers, retry policy, URL encoding, the Orval `{ data, status, headers }` envelope, response parsing, and normalized `HubApiError` behavior. Generated operations describe the wire call; they do not choose a project, grant a capability, bypass `door()`, send Mail or messenger messages, or change MCP approval policy.
6. MUST: preserve the existing admin error contract at the facade seam. `readGenerated` maps runtime failures to `ApiFailure`; legitimate status outcomes are handled from the generated response before throwing. Never inspect a thrown response body as if it necessarily carried a status, and never silently turn an absent response into an empty collection.
7. MUST: validate a generated response once at the transport/facade boundary with the generated Zod schema or the contract parser. After that boundary, feature code receives a domain view model and must not cast wire data into a screen shape.
8. MUST: keep wire and domain shapes distinct. Normalize nullable and optional generated fields, closed enums, discriminated unions, and server-specific error details in the facade or domain adapter. Do not export a generated DTO as the product model merely because the fields currently match.
9. MUST: keep server data in the one TanStack Query provider and the one query-key factory defined by `state-and-data.md`. Generated operations do not create a second cache, React context, store, or invalidation policy. Mutations invalidate or update the canonical domain key after the facade succeeds.
10. MUST: resolve project scope explicitly from the route/project owner and pass the slug or identifier to the operation. Do not read a mutable ambient project from a module singleton, infer it from a URL string in a feature, or let a generated client silently select a project.
11. MUST: mount application-wide providers once in `src/app/providers.tsx` at the lowest common correct scope. A feature must not create a second `QueryClient`, API client, tooltip/overlay provider, or project context. React context is for stable cross-route capabilities and configuration, not a mirror of server data; feature-local context needs a real shared subtree and a documented lifecycle.
12. MUST: keep non-JSON or security-sensitive protocols outside the ordinary generated JSON client: SSE/live subscriptions, terminal/WebSocket and streaming sessions, NDJSON, FormData/file uploads, browser-local and Apple Mail bridges, MCP tools, and send/approval doors. Generate their stable schemas only when the protocol adapter remains the owner of lifecycle and permission semantics.
13. MUST: migrate by a bounded vertical slice. Before changing a route group, record its operation ID, schema, project scope, cache key, loading/empty/stale/error states, retry and idempotency behavior, live invalidation, and protocol boundary. Update the active generated-client plan and remove the legacy facade path only after the generated path is verified.
14. MUST: keep generation deterministic. Orval and related generator versions are exact-pinned; generation runs from the package command, produces the same output twice, and the committed artifact must pass `generate:check`. Do not accept a generated diff that only changes ordering, timestamps, or formatting without a source-contract reason.
15. SHOULD: add a generated operation to the public package exports only after its contract has stable names, status-specific errors, URL/query encoding, and a runtime validation path. Prefer a thin facade over exposing generator-specific hooks or configuration to the feature layer.

## Context and ownership

The route or project guard is the owner of the current project. It passes a
validated slug into the feature and facade; the facade passes it into every
project-scoped generated operation. The generated client does not read the URL,
cookies, a Zustand store, React context, or a module-level mutable variable to
discover a project.

The root composition is intentionally small and ordered once in
`src/app/providers.tsx`: theme, the single TanStack `QueryClientProvider`, the
shared UI providers, then app feedback. A provider is added there only when a
capability is genuinely cross-route. A feature context may hold an adapter's
stable capabilities for one mounted subtree, but it must not duplicate server
data, query keys, project selection, or transport configuration.

A facade is the seam where four things meet: explicit scope, generated wire
operation, runtime validation, and domain mapping. Keep that seam outside JSX.
The component should receive a domain view model and named commands, not a
generated DTO, an `unknown` response, or an Orval request function.

Generated operations do not create React Query hooks. The app decides whether a
read is enabled, how it is keyed, how stale data is displayed, and what a
successful mutation invalidates. This keeps Mail reads, live invalidations,
manual draft writes, and send doors from accidentally acquiring different cache
or permission semantics.

## Enforcement

| Rule | Tool |
|---|---|
| 1, 3-5, 10-12 | review; `test/rules.test.ts` and import-boundary lint; the active generated-client plan records intentional legacy seams |
| 2, 14 | `pnpm --filter @hub/api generate:check`; generated directories are checked in and excluded from hand edits |
| 5-8 | `app/packages/api/test/generated-api.test.ts`, `test/api-client.test.ts`, the Orval envelope adapter, `readGenerated`, and `@hub/contract` parsers |
| 9, 11 | `app/apps/admin/src/app/providers.tsx`, `state-and-data.md`, the single QueryClient and query-key rules |
| 13 | review of the vertical-slice checklist; the endpoint ledger `app/packages/api/src/ledger.ts` (`@hub/api/ledger`, moved into the core by P119), checked by `apps/admin/test/rules.test.ts` |

Update this page when the generated API architecture changes.
