# Verification

Scope: what "done" means for core work. History: decision 0047.

## Rules

1. MUST: the ladder, cheapest first, run once at the very end (rule 2): `pnpm --filter @hub/admin check` (`next typegen`, `tsc`, eslint at zero problems, Vitest with `test/rules.test.ts`), then a browser pass at 360 / 768 / 1280 px, then `pnpm e2e`.
1a. MUST: a changed API contract or facade adds `pnpm --filter @hub/api generate:check`, `pnpm --filter @hub/api typecheck` and the facade tests to that final pass.
1b. MUST: a changed `packages/ui` surface adds `pnpm --filter @hub/storybook typecheck` and `build` to that final pass, and a look at the stories in light, dark and narrow.
2. MUST: typecheck, lint, build and tests run ONCE, at the very end, when all of the work is written (owner, 2026-11-23: "сборку и тайп-чек мы должны делать в самом конце, когда вообще всё готово"). Not after an edit, a slice, a phase or before a commit: no `tsc`, `pnpm typecheck`, `pnpm check`, `next build`, Vitest or e2e in between, not even "just the touched package" (they compete with the owner's machine and cost his time). A commit in between may not compile; that is expected and is fixed at the final gate. A saas restart the coordinator asks for to show the owner a screen is the only build in between. Never two e2e runs at once (one port, one seeded database), and never an e2e run while another `next` process builds into the same directory.
2a. MUST: at most two local servers at once (owner, 2026-11-23). Django, a Next app, Storybook and a docs site each count as one. Check what listens first (`lsof -nP -iTCP -sTCP:LISTEN`), stop one of yours before starting another, and stop yours when done.
3. MUST: a screen is done when its main path works with the keyboard, nothing scrolls sideways, targets are 44px high below 1024px, every state in `ui-specifications.md` has a scenario, both themes were looked at, and a cold load leaves a clean console.
4. MUST: the handoff names the rungs that ran and those that did not; a skipped rung is stated, never implied green.
5. MUST: lint has no warnings tier: every rule is an error.
5a. MUST: a path change passes the `instance-home` tests of the installer, server, projects and knowledge, and `home-seams.test.ts`.
6. MUST: `pnpm e2e` runs one throwaway stack per worker (`e2e/stacks.ts`, `HUB_E2E_WORKERS`, default 2): a fresh seeded `HUB_DB`, the fake Mailer, `next start -H 127.0.0.1` on one production build in its own `distDir`; a running `hub up` is never disturbed. Never a real send in a test.
7. MUST: every route is dynamic: the root layout keeps `dynamic = "force-dynamic"` (`architecture-and-ownership.md` rule 9), and the build needs no API.
8. SHOULD: a new screen adds a flow to `apps/admin/e2e`; a flow that creates data is named `z-*.spec.ts`.
9. SHOULD: a failure in an unrelated area is reported, not fixed in passing.
10. MUST: the final gate shows that inbound messenger events and agent sessions can create unsent drafts but cannot call an adapter, mint a background `HumanActor` or write a messenger `send_log` row.

## Enforcement

| Rule | Check |
|---|---|
| 1, 5 | `pnpm check` in `apps/admin` |
| 1a | `pnpm --filter @hub/api generate:check`; `app/packages/api/test/generated-api.test.ts` |
| 1b | the Storybook typecheck and build |
| 2, 2a, 4, 8, 9 | review of the handoff |
| 3 | `e2e/a-layout.spec.ts`, `e2e/c-console.spec.ts`, `e2e/z-keyboard.spec.ts`, `e2e/b-routing.spec.ts` |
| 6 | `playwright.config.ts`, `e2e/stacks.ts`; `test/proxy.test.ts`; `e2e/d-guards.spec.ts` |
| 7 | `e2e/d-build.spec.ts` |
| 10 | `apps/server/test/draft-only.test.ts`; `packages/agent/test/deny-modes.test.ts` |
