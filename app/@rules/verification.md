# Verification

Scope: what "done" means for admin work. Adapted from the shared "delivery and verification" page; commands are the hub's own.

## Rules

1. MUST: the ladder, cheapest first: `pnpm --filter @hub/admin check` (`next typegen`, `tsc` for the app and the node config, eslint at zero problems, Vitest including `test/rules.test.ts`), then a browser pass at 360 / 768 / 1280 px, then `pnpm e2e`.
2. MUST: build and tests run once at the end of a piece of work, not after every edit (they compete with the owner's machine). Never two e2e runs at once (one port, one seeded database), and never an e2e run while another `next` process builds into the same directory.
3. MUST: definition of done for a screen: the owner's main path works with the keyboard, no sideways scroll, targets are 44px high below 1024px, every state in `ui-specifications.md` has a scenario, light and dark were looked at, and the console is clean on a cold load (no error, no hydration message).
4. MUST: the handoff reports which rungs ran and which did not; a rung that was skipped is stated, not implied green.
5. MUST: lint has no warnings tier: every rule is an error.
5a. MUST: a path change is tested against an instance: run the installer, server, projects and knowledge `instance-home` tests (they point `HUB_HOME` at a temp folder with fixture projects and assert nothing reads the core's own `app/projects` or touches its `app/data/app.db`), and keep `home-seams.test.ts` green.
6. MUST: how e2e runs. `pnpm e2e` (Playwright, installed Chrome, `workers: 1`) starts its own stack from `playwright.config.ts`: a throwaway database that is seeded fresh (`HUB_DB` under the OS temp folder, never `app/data/app.db`), `hub project sync`, the Hono API on port 4499 with `HUB_MAILER=fake` (the only way a test sends: the fake Mailer never leaves the process, and the server refuses it without `HUB_DB`), then ONE production build of the admin into its own `distDir` (`HUB_NEXT_DIST=.next-e2e`) served by `next start -H 127.0.0.1` on port 5199. The API port is baked into the build by the `/api` rewrite, so the build runs after the API port is chosen. A running `hub up` (port 5173) or `next dev` is never disturbed. Projects: `w1280` runs every spec, `w768` and `w360` run `a-layout` (axe in both themes, no sideways scroll, 44px targets) and `c-console`. Never put a real send in a test.
7. MUST: every route is dynamic. `e2e/d-build.spec.ts` runs `next build` with no API listening and fails if the build needs one or if any route but `/_not-found` and the icon is prerendered; a page that fetches no dynamic API is prerendered with build-time data unless the root layout keeps `dynamic = "force-dynamic"` (`architecture-and-ownership.md` rule 9).
8. SHOULD: add a flow to `apps/admin/e2e` when a screen is added; flows that create data are named `z-*.spec.ts` so they run after the smoke flows.
9. SHOULD: a failure in an unrelated area is reported, not fixed in passing.

## Enforcement

| Rule | Tool |
|---|---|
| 1, 5 | `pnpm check` in `apps/admin` (`typecheck && lint && test`): includes the routing type test `test/paths.types.tsx`, the routing, proxy and send-boundary unit tests and `test/rules.test.ts` |
| 2, 4, 9 | review of the handoff |
| 3 | `pnpm e2e`: `e2e/a-layout.spec.ts` (axe, sideways scroll, 44px), `e2e/c-console.spec.ts` (clean cold load), `e2e/z-keyboard.spec.ts` and `b-routing.spec.ts` (keyboard and deep links) |
| 6 | `playwright.config.ts` (ports, `distDir`, fake Mailer, throwaway database); `e2e/d-guards.spec.ts` (loopback only, foreign Host and Origin refused) |
| 7 | `e2e/d-build.spec.ts` |
| 8 | review |
