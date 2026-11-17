# UI specifications

Scope: how UI behaviour is written down so a test can hold it. Adapted from the shared "executable UI specifications" page; there is no scenario workbench here, so the contract is carried by Playwright flows (against a production build) and Vitest over pure helpers.

## Rules

1. MUST: every screen has named scenarios for its states, and each runs in a real browser flow or a unit test: `drafts: empty`, `drafts: error`, `bulk: mutation rejected`. A state with no scenario is not done.
2. MUST: components and hooks are pure with respect to their inputs. No `Date.now()`, `new Date()` or `Math.random()` in render; take time from one injectable clock (`lib/clock.ts`).
3. MUST: logic that can be pure (route parsing, label maps, filters, guards) is a pure function with a Vitest test beside it (`*.test.ts` in `src`).
4. MUST: the e2e suite runs at 360, 768 and 1280 px; a screen has no sideways page scroll and 44px touch targets below 1024px.
5. MUST: keyboard paths are part of the contract: the review keys are one map (`REVIEW_KEYS` in `features/review/review-keys.ts`, the rows the `?` popover lists: `j`/`k` move, `Enter` goes into the card and `Esc` back, `c` "I read the checks", `x` and `Shift A` select, `d`/`s`/`h` done, skip, hold, `u` undo, `1 2 3` the version, `t` the thread, `/` search, `Shift Enter` send), `g o` / `g d` / `g b` / `g a` / `g p` go between screens; a typing field, a menu or a dialog switches them off. One shared hook (`use-hotkeys`) owns the typing guard, the modifier guard, the chord window and the remembered off switch; the chords are derived from `SECTIONS`.
5b. MUST: the review card is a pure function of one of 16 states (`features/review/card/card-state.ts`): each state names its one primary button, at most two secondaries and whether the "I read the checks" switch shows. A new state is a row in that table and in `test/card-state.test.ts`.
5d. MUST: a reversible move says so and offers the way back: Done, Skip and Hold raise a toast with Undo (one draft, or one toast for a whole selection, whose Undo puts every draft back), and the Client menu does the same for a flag; only an irreversible one asks first (Send, Do not contact), in place, never in a dialog. Every one of the 16 card states is reachable and has a scenario: 12 (Mail cannot be read, with Read again) and 16 (a batch waiting for the agent, the pane of `paneStateOf`) are not states of a draft the list can fake, so they are driven by a patched Mail read and a real queued batch.
5a. MUST: every screen has a deep-link scenario: a cold load of its real path (`/drafts/42?project=lisbon&filter=hold`) and a reload keep project, section, filter and the selected subject (`e2e/b-routing.spec.ts`).
5c. MUST: every route has a hydration scenario: a cold load at each width shows no console error, warning or hydration message, and the server HTML is the loading state, never data, a viewport branch or a stored value (`e2e/c-console.spec.ts`). A component that reads the viewport, storage, the cookie or the clock follows `state-and-data.md` rule 11.
6. SHOULD: an e2e flow fails on any console error.
7. SHOULD: a handoff attaches evidence: the commands run, the viewports opened, one screenshot per state changed.
8. Utility CSS must be static strings (see `stylesheets-and-class-lists.md`); a test may read class names, so they are never built at runtime.

## Enforcement

| Rule | Tool |
|---|---|
| 1, 4-6, 5a, 5c, 5d | Playwright (`pnpm e2e`, `apps/admin/e2e`; how it runs: `verification.md` rule 6); viewport projects `w360`/`w768`/`w1280` (`a-layout.spec.ts` and `c-console.spec.ts` run at all three; flows that write run at 1280) |
| 5, 5b, 5d | `e2e/y-review-keys.spec.ts` (Enter, Esc, Shift+A, `?`), `e2e/z-keyboard.spec.ts` (the whole loop without a mouse), `e2e/y-card-states.spec.ts` (the primary count of 15 states and the 24 px gap; 16 in `e2e/z-bulk.spec.ts`), `e2e/z-selection.spec.ts` (the bulk Undo), `e2e/z-client-menu.spec.ts` (the Do not contact confirm), `e2e/y-checked-guard.spec.ts` (state 12) |
| 1 | `e2e/y-status-line.spec.ts` (the shell status line: all clear, needs you, blocked, checking, unknown, server not answering; `test/status-line.test.ts` for its words) |
| 2 | eslint `no-restricted-properties` on `Date.now` / `Math.random` (error) |
| 3 | `pnpm test` (Vitest): paths, search, guards, proxy, hotkeys, title, card states |
| 7 | review |
