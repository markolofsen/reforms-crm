# Accessibility

Scope: the baseline every screen meets. Adapted from the shared "accessibility, content and i18n" page; i18n ownership does not apply (English only).

## Rules

1. MUST: semantic elements first (`button` for actions, `a` with `href` for navigation, `table` for tabular data, headings in order). A clickable `div` is a defect.
2. MUST: every control has an accessible name; every input has an associated label; icon-only controls carry `aria-label`.
3. MUST: everything works with the keyboard; focus is visible and never trapped; on a list row and a table row the focus ring is inset, so it never overlaps a neighbour or the pane's edge; after a route change or inline disclosure focus goes somewhere sensible. The skip link is an anchor whose click handler focuses `#main` and leaves the address alone (a plain fragment link would add a hash and a history entry); after a route change Next leaves focus unchanged (research 19), so check where it lands.
4. MUST: touch targets are at least 44px high below 1024px.
5. MUST: status changes (saved, failed, count updated) reach a live region (`role="status"` or `role="alert"`), not only a toast. New Activity sessions that arrive by a live update are announced in a polite status region ("2 new"), never by moving focus or the scroll (P50); the agent feed's newest row the same way ("Agent: asks you a question", P59), whose links are one tab stop moved with the arrow keys. A selection is announced by the list's header line, which is that live region while drafts are selected ("2 selected"; `admin-principles.md` rule 11). The agent's pointer (P72) is announced in a polite status region ("Agent points at a row: <note>") and never moves focus or takes the scroll while he types; the dock's "Agent points at … · Show" line is a polite status region too. A row the agent can be pointed at by him (Knowledge's) is a Tab stop with the inset ring of rule 3.
6. MUST: color is never the only carrier of status; contrast meets WCAG AA in light and dark.
7. MUST: animation respects `prefers-reduced-motion`.
8. MUST: copy states what happened and what to do next; an error names the cause and offers a retry.
9. SHOULD: an automated axe scan runs per screen in both themes in the e2e lane.
10. MUST: the terminal dock (P49) is a named column (`<aside aria-label="Terminal">`; the narrow layer is a section of the same name with the heading "Terminal"). Its separator is a focusable `role="separator"` with `aria-orientation="vertical"`, `aria-valuemin`, `aria-valuemax` and `aria-valuenow` in pixels, moved with ArrowLeft and ArrowRight (24px) and Home (the default), as well as by a pointer. xterm's input is named "Terminal input"; its screen-reader mode stays off (costly; research 21 section 3). Collapsed, the dock is one named button ("Terminal", the strip; the phone's top-line button below 640px) with `aria-keyshortcuts` and a description of its state (the program, running or not); the vertical label is decoration. Opening moves focus into the open tab's terminal; hiding returns it to the strip (or the phone's button), or to `#main` when none is visible. Inside the terminal every key is the program's (Escape included) except Ctrl+`, so focus is never trapped: Ctrl+` hides it and focus comes back.

## Enforcement

| Rule | Tool |
|---|---|
| 1-3 | `eslint-plugin-jsx-a11y` strict preset (error in `pnpm lint`) |
| 3-5, 8 | e2e keyboard and state scenarios (`e2e/z-keyboard.spec.ts`, `e2e/b-routing.spec.ts` skip link, `e2e/z-selection.spec.ts` the selection count in the header line; `e2e/zz-live.spec.ts` the "N new" region) |
| 9 | `@axe-core/playwright` 4.14.0 (`e2e/a-layout.spec.ts`: every screen, light and dark, three widths, `next start` build) |
| 10 | `e2e/z-terminal.spec.ts` (focus in on open and back to the toggle on hide, the separator's value, Escape reaches the program); `packages/ui/test/side-dock.test.ts` (the separator's keys); axe on the open column in `e2e/a-layout.spec.ts` |
| 7 | `e2e/y-status-line.spec.ts` (with `prefers-reduced-motion` no animation runs in the Drafts status line or on the Overview; the same check with motion allowed proves it can see one) |
| 4, 6 | browser pass at 360 / 768 / 1280 (see `verification.md`) |
