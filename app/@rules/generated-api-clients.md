# Generated API clients

Scope: `@hub/api` (the emitted OpenAPI document, Orval output, the runtime envelope, the endpoint ledger) and the admin facades over it. Streams, sockets, uploads, MCP and send doors keep their own rules. History: decision 0047.

## Rules

1. MUST: the `@hub/contract` schemas and `app/packages/api/openapi.json`, which the server emits from its declared operations (`composition/operations.ts`), are one contract; no second hand-written wire schema. Replies are parsed with the contract schemas; there is no generated Zod.
2. MUST: `src/generated/` is never hand-edited; it is replaced by `pnpm --filter @hub/api generate`.
3. MUST: an operation in the document is called through its generated function inside an admin facade; no admin module writes an `/api/` path, its query serialisation or its response type by hand.
4. MUST: consumers import only `@hub/api`, `@hub/api/runtime` and `@hub/api/ledger`; features never import generated deep paths or the transport.
5. MUST: `@hub/api/runtime` owns credentials, retry, encoding, the envelope and `HubApiError`; an operation never chooses a project or opens a send door.
6. MUST: `readGenerated` maps failures to `ApiFailure`; an absent response never becomes an empty collection.
7. MUST: a reply is validated once at the facade (`readGenerated(operation(...), schema, statuses)`); features get a domain view model.
8. MUST: wire and domain shapes stay distinct; a generated DTO is never the product model.
9. MUST: server data stays in the one Query provider and key factory (`state-and-data.md`); generated code adds no cache or context.
10. MUST: the project slug is passed explicitly from the route's project owner; nothing reads an ambient project.
11. MUST: providers are mounted once (`architecture-and-ownership.md` rule 9a).
12. MUST: SSE, sockets, NDJSON, uploads, local and Apple Mail bridges, MCP and send doors stay outside the ordinary JSON client; their URL comes from `URL_HELPERS` and their adapter owns lifecycle and permission.
13. MUST: a route group migrates as one vertical slice and its legacy path is deleted in the same change.
14. MUST: generation is deterministic: Orval exact-pinned, the same output twice, `generate:check` green.
15. SHOULD: a thin facade, never generator hooks.

## Enforcement

| Rule | Check |
|---|---|
| 1 | `apps/server/test/http/openapi.test.ts` (stale document, undeclared route) |
| 2, 14 | `pnpm --filter @hub/api generate:check` |
| 3, 4, 12 | rules test "no admin module writes an /api/ path" and the ledger door and URL-helper tests; `app/test/boundaries.test.ts` |
| 5-8 | `app/packages/api/test/generated-api.test.ts`; `test/api-client.test.ts` |
| 9-11 | `state-and-data.md`; `architecture-and-ownership.md` |
| 13, 15 | review; `app/packages/api/src/ledger.ts` |

Update this page when the generated API architecture changes.
