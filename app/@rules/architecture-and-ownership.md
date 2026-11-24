# Architecture and ownership

Scope: the admin's layers and config. Why: decision 0015; history: decision 0047.

## Rules

1. MUST: one owner per concern: a route name and path, a storage key, a query key, a status vocabulary or a label map has one definition, and every other file imports it.
2. MUST: the admin's layers are `app/`, `routes/` (no React), `lib/`, `hooks/`, `components/` (app-level UI; `app-link.tsx` the one link, `local-action.tsx` the one Open) and `features/<job>/`. Imports go downward only and no feature imports another's internals. `@hub/ui` is below all of them: it imports no app, no other `@hub/*`, no `next/*` and no `@/`.
3. MUST: the admin is a client of the Hono API only: it calls `/api` on its own origin, imports no Node-only `@hub/*` package and no `@hub/server` value, and has no Server Action. One exception (P133): `src/app/instance-name.ts` reads the instance's name through `@hub/config/paths` for the root layout's title template, and no other admin file imports `@hub/config/paths`. No `dangerouslySetInnerHTML`; the one parsed-markup exception is `@hub/diagram/render` (decision 0035, P135: Help's scheme and the client map draw through it, and no admin file imports `mermaid` or adopts markup).
3a. MUST: an operation in the `@hub/api` OpenAPI document is called through its generated function inside `lib/api/*`; no admin module writes an `/api/` path (streams and files use `URL_HELPERS` of `@hub/api/ledger`).
3b. MUST: a package exposes one subject through exact public subpaths; no compatibility barrel: a split moves its callers and deletes the old path in the same change.
3c. MUST: dependencies run one way: contract and config → domain packages → protocol adapters → server composition → API facades → features. A server route module gets its domain's context (`<domain>/context.ts`) and builds no adapter or send capability.
4. MUST: wire shape and domain shape differ; a reply is parsed at the one boundary (`lib/api/client.ts`), never shaped by hand in a screen.
5. MUST: one alias, `@/*` → `./src/*`, declared once in `apps/admin/tsconfig.json`; no bundler or test config declares an alias.
6. MUST: two tsconfigs, the app's and `tsconfig.node.json` (configs, e2e, tests); `pnpm typecheck` runs `next typegen` first.
7. MUST: `verbatimModuleSyntax`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride` and `noFallthroughCasesInSwitch` stay on over `strict` and `noUncheckedIndexedAccess`.
8. MUST: `next.config.ts` keeps, each with its reason in a comment, `typedRoutes`, `agentRules: false`, `transpilePackages`, `proxyTimeout`, the `/api` rewrite, `distDir` from `HUB_NEXT_DIST` and `turbopack.root` from `HUB_NEXT_ROOT`; no `output`, `webpack`, `cacheComponents` or `reactCompiler`.
9. MUST: the root layout exports `dynamic = "force-dynamic"` and mounts the `ThemeProvider` of `@hub/ui/product/shell/theme` and `Providers`; API replies live only in the Query cache.
9a. MUST: app-wide providers are composed once, in `src/app/providers.tsx`; no feature mounts a second QueryClient, theme, overlay or project context.
10. MUST: server components are route files, layouts and metadata, and stay thin; `"use client"` sits at `features/<job>/section.tsx` or the hook or component that needs it.
11. MUST: `src/proxy.ts` refuses with 403 a `Host` outside `ALLOWED_HOSTNAMES` of `@hub/config` and a mutating request with a non-loopback `Origin`, in front of pages and the `/api` rewrite; the Hono guard reads the same list.
12. MUST: the admin listens on loopback only: `next dev` and `next start` carry `-H 127.0.0.1` and take the port from `HUB_ADMIN_PORT`. A variable the build reads is in `globalPassThroughEnv` of `app/turbo.json`.
13. MUST: no secret is held or shown by the browser: no `NEXT_PUBLIC_*`, no `.env*` in `app/`, nothing in the admin reads `state/secrets`. Settings may send a token to the server, never read it back (decision 0020). The stricter doors (terminal, drops, send tickets, focus, local Open, app check, autostart) take only the exact admin Origin with `Sec-Fetch-Site: same-origin`; the socket a single-use ticket.
14. SHOULD: a new dependency has a written reason (what it replaces, why coss, Next or the platform cannot); MUST: every dependency is an exact pin.
15. MUST: shared UI lives in `@hub/ui`, exported by exact subpaths (no wildcard, no barrel), with a story in the same change.
15a. MUST: `apps/storybook` composes public `@hub/ui` exports with local fixtures and imports no app API, generated client, facade or runtime session.
16. MUST: live panels are SQLite triggers, a tailer and one same-origin SSE route (`GET /api/live`), nothing else (decision 0028); every table has its three `live_*` triggers.
17. MUST: the shared focus has one door (`POST /api/focus`), one file (`state/focus.json`, ids only) and one reader (`readFocus` of `@hub/agent/focus`); the agent's pointer has one writer (`highlight`), one file and one GET (decisions 0029, 0038). The agent never writes the focus, the admin never writes the pointer, and no tool clicks or navigates for the owner.

## Enforcement

| Rule | Check |
|---|---|
| 1, 4, 10 | review |
| 2 | eslint `no-restricted-imports`; `test/route-files.test.ts`; `packages/ui/test/ui.test.ts` and its eslint |
| 3 | eslint `no-restricted-imports` and `no-restricted-syntax`; rules test "no dangerouslySetInnerHTML", "mermaid is imported only by @hub/diagram/render" and "only app/instance-name.ts reads the instance"; `app/test/boundaries.test.ts`; `e2e/y-help.spec.ts`, `e2e/y-client-map.spec.ts` |
| 3a | `test/api-client.test.ts`; `generated-api-clients.md` |
| 3b-3c, 19 | `app/test/boundaries.test.ts` |
| 5 | rules test "one alias source" |
| 6-7 | `pnpm typecheck`; `consistent-type-imports` |
| 8, 12 | rules test "next.config" and "dev and start bind to 127.0.0.1"; `e2e/d-guards.spec.ts` |
| 9 | rules test "the root layout is force-dynamic"; `e2e/d-build.spec.ts`; `e2e/c-console.spec.ts` |
| 9a | review of `src/app/providers.tsx` |
| 11 | `test/proxy.test.ts`; `e2e/d-guards.spec.ts` |
| 13 | rules test "no NEXT_PUBLIC_ variable, no .env file" and "nothing under the admin reads state/secrets"; `apps/server` guard tests |
| 14 | rules test "every dependency is an exact pin"; the reason by review |
| 15, 15a | `packages/ui/test/exports.test.ts`, `packages/ui/test/stories.test.ts` |
| 16 | `packages/db/test/live.test.ts`; `apps/server/test/live/live.test.ts`; `e2e/zz-live.spec.ts` |
| 17 | `apps/server/test/agent/focus.test.ts`; `packages/agent/test/focus.test.ts`; `test/focus.test.ts` |

Update this page when the architecture changes.
