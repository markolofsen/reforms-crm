# Local admin app rules

Rules for `app/apps/admin` (Next.js 16, React 19, coss, the Hono API behind `/api`; decision 0015) and its packages. A rule is an invariant and its check, or says "review". The gates run once, at the very end (`verification.md` rule 2). History: decision 0047.

## Reading order

Every change: read these five first.

| Page | Owns |
|---|---|
| `architecture-and-ownership.md` | layers, imports, config, loopback, secrets, dependencies, `@hub/ui` |
| `structure-and-naming.md` | folders, file names, size caps |
| `state-and-data.md` | Query, keys, storage, live updates, stable first render |
| `approval-and-capabilities.md` | safety: draft-only, the send door, agent modes |
| `verification.md` | what done means, the one final gate, e2e |

Then by area:

| Area | Page |
|---|---|
| What a screen shows and asks | `admin-principles.md` |
| Paths, links, filters, keys, titles | `routes-and-url-state.md` |
| Generated clients and facades | `generated-api-clients.md` |
| UI layers and shared surfaces | `ui-composition.md` |
| Screen states and scenarios | `ui-specifications.md` |
| coss, tokens, themes | `design-system-and-tokens.md` |
| Names, focus, keyboard, contrast | `accessibility.md` |
| Class strings, `cn` | `stylesheets-and-class-lists.md` |
| `any`, casts, unions | `typing.md` |
| Agents editing the code | `agent-guardrails.md` |
| Live edits on `app-live` | `live-edit.md` |
| Dev-time skills | `skills.md` |
| Provenance | `SOURCE.md` |

## Standing rules

1. MUST: read `@docs/core/06-local-admin-app.md` and `@docs/core/08-local-app-stack.md` before a first change. Review.
2. MUST: coss first (`design-system-and-tokens.md` rule 1); primary work is inline, not in a dialog. Review.
3. MUST: the agent never sends on its own and has no path to a send but one (decision 0011, amended by decision 0046): in an attended session, on the owner's word for that chat, `messenger_send` hands ONE messenger draft to the same door as the owner's Send; never Mail, never unattended. Everything else is sent only by a person's Send, one draft at a time after the exact text was seen, through the send door (`approval-and-capabilities.md` rules 10-14). Decision 0061 additionally permits owner-scoped public Watch membership and reviewed replies through the protected Watch policy and the same staged send protocol (`approval-and-capabilities.md` rule 17); no ordinary draft/inbound path gains sending. Checked by `apps/server/test/draft-only.test.ts`.
4. MUST: an agent edit to the admin is one commit on `app-live` (`live-edit.md`); never edit `apps/admin` in the main checkout while a live session runs. Checked by the live-edit hook.
5. MUST: SQLite is working state only; mail is read only through Apple Mail (decision 0026); Notion is the CRM. A schema change is a migration. Review.
6. MUST: the UI language is English. Checked by `test/rules.test.ts` "no Cyrillic" (one allowed line: the Re/Fwd prefixes of `apps/server/src/mail/sent.ts`).
7. MUST: the admin binds to 127.0.0.1 and refuses a foreign Host or Origin; the stricter doors take only the exact admin Origin (`architecture-and-ownership.md` rules 11-13). No secret in a tracked file, no `NEXT_PUBLIC_*`.
8. MUST: locations come only from `@hub/config/paths` (`hubPaths`); no `join(root, "projects"|…)`, no direct read of `HUB_HOME`, `HUB_PROJECTS`, `HUB_DB`, `HUB_CONFIG_DIR` or `HUB_CONFIG_FILE` outside `packages/config` (decision 0016). Checked by `apps/installer/test/home-seams.test.ts`.
8a. MUST: one screen per job; a new section needs a written reason here (`admin-principles.md` rule 2). Sections: `src/routes/sections.ts`; what each shows: `@docs/core/06-local-admin-app.md`. Checked by `test/route-files.test.ts`; the reason by review. Written reasons: Watch (P144) is its own section, not part of Messengers, because a Messengers row is a private client chat, while a public group's members are not clients. Under decision 0061 a public reply remains bound to the source group/message through Watch's guarded operation; mixing those authors into private Messenger rows would create the wrong conversation identity.
9. MUST: a screen is done by `verification.md` rule 3.
10. MUST: dev-time skills are referenced in `skills.md`, not copied; run-time skills live in `reforms-hub/skills/`. Review.
11. MUST: `app/` is one pnpm + Turborepo monorepo (decision 0004), each package owning one subject; no package lockfile; tsconfig, Vitest and Node eslint configs are one call of `@hub/config`; `FILE_RATCHET` counts only go down. Every table has a `project` column and every query filters by it. Checked by `app/test/boundaries.test.ts` and `packages/config/test/lint-ratchet.test.ts`.
11a. MUST: `@hub/api` is transport only (the emitted OpenAPI document, Orval output, the runtime envelope; replies are parsed with `@hub/contract` schemas, there is no generated Zod); it imports no React, Query, feature code or policy. Checked by `app/test/boundaries.test.ts`.
11b. MUST: `apps/storybook` uses local fixtures only and never imports admin features, generated clients or runtime sessions; new shared product UI gets a story in the same change. Checked by `packages/ui/test/stories.test.ts`.
12. MUST: coss copies are never hand-edited (`design-system-and-tokens.md` rule 2).
13. MUST: a table is `@hub/ui/product/list/data-table`; no data-grid library is a dependency. Review.
14. MUST: the admin reads a JSON reply only through `lib/api/client.ts` (`read` or `readGenerated`, `generated-api-clients.md`); `GET /api/live` only in `lib/cache/live.ts`. Checked by eslint and `test/api-client.test.ts`.
15. MUST: in a Drizzle correlated sub-select, write literal table names (Drizzle drops the qualifier and `id` becomes ambiguous). Review.
16. MUST: the database is not a client directory (decision 0009): a `clients` row exists only for a recorded draft, a kept message, an escalated owed row or a linked chat; never bulk-copied from Notion, never a Notion-fact column (its `notion_page_id` is the card's key, not a fact; P141 C1), never deleted (a merge keeps the old row with `merged_into`, C4). Checked by `packages/db` tests and review.
17. MUST: only an entry point that knows a person is present imports `@hub/messengers/human` and mints a `humanActor`; the agent's messenger tools write through `@hub/db` only. The autolink links one Notion record by phone or username, never by name (decision 0036). Checked by `app/test/boundaries.test.ts` and `packages/messengers` tests.
18. MUST: the server and packages log through `ops(source)` of `@hub/log/ops`, never a raw `console.*`; a failure is logged once where it is caught, never with a message's text (`@docs/core/28-ops-log.md`). Checked by `apps/installer/test/ops-log-rules.test.ts`.
19. MUST: package edges follow the matrix in `app/test/boundaries.test.ts` and the endpoint ledger (`packages/api/src/ledger.ts`); unknown tools and capabilities fail closed. Checked by `app/test/boundaries.test.ts`.
20. MUST: Messengers rows have no compose box; Reply writes an unsent draft. Review.
21. MUST: agent code never imports a provider adapter, `@hub/messengers/human`, `@hub/send` or a send capability. Checked by `app/test/boundaries.test.ts`.
