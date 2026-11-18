# Accessibility

Scope: the baseline every screen meets. Adapted from the shared "accessibility, content and i18n" page; i18n ownership does not apply (English only).

## Rules

1. MUST: semantic elements first (`button` for actions, `a` with `href` for navigation, `table` for tabular data, headings in order). A clickable `div` is a defect.
2. MUST: every control has an accessible name; every input has an associated label; icon-only controls carry `aria-label`.
3. MUST: everything works with the keyboard; focus is visible and never trapped; on a list row and a table row the focus ring is inset, so it never overlaps a neighbour or the pane's edge; after a route change or inline disclosure focus goes somewhere sensible. The skip link is an anchor whose click handler focuses `#main` and leaves the address alone (a plain fragment link would add a hash and a history entry); after a route change Next leaves focus unchanged (research 19), so check where it lands.
4. MUST: touch targets are at least 44px high below 1024px.
5. MUST: status changes (saved, failed, count updated) reach a live region (`role="status"` or `role="alert"`), not only a toast. A selection is announced by the list's header line, which is that live region while drafts are selected ("2 selected"; `admin-principles.md` rule 11).
6. MUST: color is never the only carrier of status; contrast meets WCAG AA in light and dark.
7. MUST: animation respects `prefers-reduced-motion`.
8. MUST: copy states what happened and what to do next; an error names the cause and offers a retry.
9. SHOULD: an automated axe scan runs per screen in both themes in the e2e lane.

## Enforcement

| Rule | Tool |
|---|---|
| 1-3 | `eslint-plugin-jsx-a11y` strict preset (error in `pnpm lint`) |
| 3-5, 8 | e2e keyboard and state scenarios (`e2e/z-keyboard.spec.ts`, `e2e/b-routing.spec.ts` skip link, `e2e/z-selection.spec.ts` the selection count in the header line) |
| 9 | `@axe-core/playwright` 4.14.0 (`e2e/a-layout.spec.ts`: every screen, light and dark, three widths, `next start` build) |
| 7 | `e2e/y-status-line.spec.ts` (with `prefers-reduced-motion` no animation runs in the Drafts status line or on the Overview; the same check with motion allowed proves it can see one) |
| 4, 6 | browser pass at 360 / 768 / 1280 (see `verification.md`) |
