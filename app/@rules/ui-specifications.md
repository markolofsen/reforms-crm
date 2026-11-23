# UI specifications

Scope: how UI behaviour is written so a test holds it: Playwright flows on a production build and Vitest over pure helpers. History: decision 0047.

## Rules

1. MUST: every screen has named scenarios for its states (`drafts: empty`, `drafts: error`, `drafts: mutation rejected`), each run by a flow or a unit test; a state with no scenario is not done.
1a. MUST: the shell has the scenarios `status line: clear | attention | blocked`, `shell: one project` and `shell: two projects`.
2. MUST: components and hooks are pure in their inputs: no `Date.now()`, `new Date()` or `Math.random()` in render; time comes from `lib/clock.ts`.
3. MUST: logic that can be pure (parsing, label maps, filters, guards) is a pure function with a Vitest test.
4. MUST: e2e runs at 360, 768 and 1280 px: no sideways scroll, 44px targets below 1024px.
4a. MUST: a screen shows only what the next decision needs: at most 36 tab stops in the first viewport (44 while selecting), and on a phone Mail's first row at most 200 px down.
5. MUST: keyboard paths are contract: the list keys (`LIST_KEYS`, `SELECTION_KEYS`) are shared by Mail and Messengers through `ConversationWorkspace`, and each channel's action keys live in its own `keys.ts`.
5a. MUST: every screen has a deep-link scenario: a cold load and a reload keep project, section, filter and subject.
5b. MUST: the review card is a pure function of one state of `CARD_STATES` (`features/mail/draft/card-state.ts`), each naming its one primary, at most two secondaries and `canCheck`.
5c. MUST: every route has a hydration scenario: a cold load at each width with a clean console, the server HTML being the loading state.
5d. MUST: a reversible move offers Undo in a toast; only an irreversible one asks first; every card state has a scenario.
5e. MUST: Mail and Messengers share the conversation frame (`ui-composition.md` rule 6).
5f. MUST: an irreversible decision is reviewed once, in `ReviewDialog` of `@hub/ui/product/conversation/review-dialog`: blockers first with their fix, one confirm, off while a blocker stands.
6. SHOULD: an e2e flow fails on any console error.
7. SHOULD: a handoff attaches one screenshot per changed state.
8. MUST: utility classes are static strings (`stylesheets-and-class-lists.md`).

## Enforcement

| Rule | Check |
|---|---|
| 1, 1a, 4, 5a, 5c, 6 | `pnpm e2e`: `e2e/a-layout.spec.ts`, `e2e/c-console.spec.ts`, `e2e/b-routing.spec.ts`, `e2e/y-status-line.spec.ts`, `e2e/y-overview.spec.ts` |
| 2 | eslint `no-restricted-properties` |
| 3 | `pnpm test` (Vitest) |
| 4a | `e2e/a-layout.spec.ts` (`CONTROL_CAP`, `FIRST_ROW_MAX_PHONE`); `e2e/z-selection.spec.ts` |
| 5, 5b, 5d | `e2e/y-review-keys.spec.ts`, `e2e/z-keyboard.spec.ts`, `e2e/y-card-states.spec.ts`, `e2e/z-client-menu.spec.ts` |
| 5e | review; the Mail and Messengers conversation flows |
| 5f | `packages/ui/test/review-dialog.test.tsx`; `e2e/z-send.spec.ts` |
| 7 | review |
| 8 | `stylesheets-and-class-lists.md` |
