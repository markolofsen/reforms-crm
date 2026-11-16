# UI specifications

Scope: how UI behaviour is written down so a test can hold it. Adapted from the shared "executable UI specifications" page; there is no scenario workbench here, so the contract is carried by Playwright flows (against a production build) and Vitest over pure helpers.

## Rules

1. MUST: every screen has named scenarios for its states, and each runs in a real browser flow or a unit test: `drafts: empty`, `drafts: error`, `bulk: mutation rejected`. A state with no scenario is not done.
2. MUST: components and hooks are pure with respect to their inputs. No `Date.now()`, `new Date()` or `Math.random()` in render; take time from one injectable clock (`lib/clock.ts`).
3. MUST: logic that can be pure (route parsing, label maps, filters, guards) is a pure function with a Vitest test beside it (`*.test.ts` in `src`).
4. MUST: the e2e suite runs at 360, 768 and 1280 px; a screen has no sideways page scroll and 44px touch targets below 1024px.
5. MUST: keyboard paths are part of the contract (`j`/`k`/`d`/`x` lists, `c` for "I read the checks", `g o` / `g d` / `g b` / `g a` / `g p` between screens, Escape, Enter); one shared hook (`use-hotkeys`) owns the typing guard, the modifier guard, the chord window and the remembered off switch; the chords are derived from `SECTIONS`.
5b. MUST: the review card is a pure function of one of 16 states (`features/review/card/card-state.ts`): each state names its one primary button, at most two secondaries and whether the "I read the checks" switch shows. A new state is a row in that table and in `test/card-state.test.ts`.
5a. MUST: every screen has a deep-link scenario: a cold load of its real path (`/drafts/42?project=lisbon&filter=hold`) and a reload keep project, section, filter and the selected subject (`e2e/b-routing.spec.ts`).
5c. MUST: every route has a hydration scenario: a cold load at each width shows no console error, warning or hydration message, and the server HTML is the loading state, never data, a viewport branch or a stored value (`e2e/c-console.spec.ts`). A component that reads the viewport, storage, the cookie or the clock follows `state-and-data.md` rule 11.
6. SHOULD: an e2e flow fails on any console error.
7. SHOULD: a handoff attaches evidence: the commands run, the viewports opened, one screenshot per state changed.
8. Utility CSS must be static strings (see `stylesheets-and-class-lists.md`); a test may read class names, so they are never built at runtime.

## Enforcement

| Rule | Tool |
|---|---|
| 1, 4-6, 5a, 5c | Playwright (`pnpm e2e`, `apps/admin/e2e`; how it runs: `verification.md` rule 6); viewport projects `w360`/`w768`/`w1280` (`a-layout.spec.ts` and `c-console.spec.ts` run at all three; flows that write run at 1280) |
| 2 | eslint `no-restricted-properties` on `Date.now` / `Math.random` (error) |
| 3 | `pnpm test` (Vitest): paths, search, guards, proxy, hotkeys, title, card states |
| 7 | review |
