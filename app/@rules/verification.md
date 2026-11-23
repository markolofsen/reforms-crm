# Verification

Scope: what "done" means for admin work. Adapted from the shared "delivery and verification" page; commands are the hub's own.

## Rules

1. MUST: the ladder, cheapest first, run once at the very end (rule 2): `pnpm --filter @hub/admin check` (`next typegen`, `tsc` for the app and the node config, eslint at zero problems, Vitest including `test/rules.test.ts`), then a browser pass at 360 / 768 / 1280 px, then `pnpm e2e`.
1a. MUST: when a generated API contract or facade changes, run `pnpm --filter @hub/api generate:check`, `pnpm --filter @hub/api typecheck`, and the affected facade/API tests at the final verification pass. A green admin check does not prove generated output is deterministic or that its package typechecks.
1b. MUST: when a reusable surface in `packages/ui` or a shared conversation/composer layout changes, run `pnpm --filter @hub/storybook typecheck` and `pnpm --filter @hub/storybook build` at the final verification pass, then review the affected stories in light, dark, narrow and keyboard-sensitive states. Storybook is a visual contract, not an optional demo; its a11y addon runs with `test: "error"`.
2. MUST: typecheck, lint, build and tests run ONCE, at the very end, when all of the work is written (owner, 2026-11-23: "сборку и тайп-чек мы должны делать в самом конце, когда вообще всё готово"). Not after an edit, a slice, a phase or before a commit: no `tsc`, `pnpm typecheck`, `pnpm check`, `next build`, Vitest or e2e in between, not even "just the touched package" (they compete with the owner's machine and cost his time). A commit in between may not compile; that is expected and is fixed at the final gate. A saas restart the coordinator asks for to show the owner a screen is the only build in between. Never two e2e runs at once (one port, one seeded database), and never an e2e run while another `next` process builds into the same directory.
3. MUST: definition of done for a screen: the owner's main path works with the keyboard, no sideways scroll, targets are 44px high below 1024px, every state in `ui-specifications.md` has a scenario, light and dark were looked at, and the console is clean on a cold load (no error, no hydration message).
4. MUST: the handoff reports which rungs ran and which did not; a rung that was skipped is stated, not implied green.
5. MUST: lint has no warnings tier: every rule is an error.
5a. MUST: a path change is tested against an instance: run the installer, server, projects and knowledge `instance-home` tests (they point `HUB_HOME` at a temp folder with fixture projects and assert nothing reads the core's own `app/projects` or touches its `app/data/app.db`), and keep `home-seams.test.ts` green.
6. MUST: how e2e runs. `pnpm e2e` (Playwright, installed Chrome) starts one stack per worker from `playwright.config.ts` and `e2e/stacks.ts` (P121 T4): workers and stacks are `HUB_E2E_WORKERS` (default 2 to keep the Mac usable; `HUB_E2E_WORKERS=1` is the serial run; never `--workers` above it, the config refuses). Stack i is a throwaway instance with a database seeded fresh (`HUB_DB` under the run's temp root in the OS temp folder, never `app/data/app.db`), `hub project sync`, the Hono API on port 4499+i with `HUB_MAILER=fake` (the only way a test sends: the fake Mailer never leaves the process, and the server refuses it without `HUB_DB`), and `next start -H 127.0.0.1` on port 5199+i of ONE production build of the admin in its own `distDir` (`HUB_NEXT_DIST=.next-e2e`), built by stack 0 before the others start. The build bakes its `/api` rewrite to stack 0's port; `HUB_E2E_RUNTIME_API=1` (set only by `e2e/stacks.ts`) makes `src/proxy.ts` send `/api` to the process's own `HUB_PORT`. Worker i (`TEST_PARALLEL_INDEX`) reads only stack i (`HUB_E2E_*`). A running `hub up` (port 5173) or `next dev` is never disturbed. Projects, in dependency order on every stack: `guards` (every `a-` to `y-` spec and `smoke`, at 1280, the seed untouched), then `flows` (`z-*`, which create data) and the 768 and 360 px passes of `a-layout` (axe in both themes, no sideways scroll, 44px targets) and `c-console`, and `live` (`zz-live`) last, because it stops and restarts its stack's API (P50). Never put a real send in a test.
7. MUST: every route is dynamic. `e2e/d-build.spec.ts` runs `next build` with no API listening and fails if the build needs one or if any route but `/_not-found` and the icon is prerendered; a page that fetches no dynamic API is prerendered with build-time data unless the root layout keeps `dynamic = "force-dynamic"` (`architecture-and-ownership.md` rule 9).
8. SHOULD: add a flow to `apps/admin/e2e` when a screen is added; flows that create data are named `z-*.spec.ts`, which puts them in the `flows` project, after `guards` on every stack.
9. SHOULD: a failure in an unrelated area is reported, not fixed in passing.
10. MUST: the final safety and architecture pass proves that inbound Messenger
events and unattended/attended agent sessions can create unsent drafts but
cannot call an adapter, mint a background `HumanActor` or create a Messenger
send-log row; route/OpenAPI coverage, raw-path allow-list, package-boundary,
single-hotkey-dispatcher and single-provider checks are included. The Mail
composer is checked both with and without an inbound message.

## Enforcement

| Rule | Tool |
|---|---|
| 1, 5 | `pnpm check` in `apps/admin` (`typecheck && lint && test`): includes the routing type test `test/paths.types.tsx`, the routing, proxy and send-boundary unit tests and `test/rules.test.ts` |
| 1a | `pnpm --filter @hub/api generate:check`, `pnpm --filter @hub/api typecheck`, and `app/packages/api/test/generated-api.test.ts` |
| 1b | `pnpm --filter @hub/storybook typecheck`, `pnpm --filter @hub/storybook build`, and the Storybook browser review |
| 2, 4, 9 | review of the handoff |
| 3 | `pnpm e2e`: `e2e/a-layout.spec.ts` (axe, sideways scroll, 44px), `e2e/c-console.spec.ts` (clean cold load), `e2e/z-keyboard.spec.ts` and `b-routing.spec.ts` (keyboard and deep links) |
| 6 | `playwright.config.ts` and `e2e/stacks.ts` (stacks, ports, `distDir`, fake Mailer, throwaway databases), `test/proxy.test.ts` (the runtime API is off unless set); `e2e/d-guards.spec.ts` (loopback only, foreign Host and Origin refused) |
| 7 | `e2e/d-build.spec.ts` |
| 8 | review |
| 10 | P112/P116 safety, route-coverage, package-boundary and provider/hotkey checks; focused Messenger and Mail composer scenarios |
