# Accessibility

Scope: the baseline every screen meets (English only, no i18n). History: decision 0047.

## Rules

1. MUST: semantic elements first: `button` for actions, `a href` for navigation, `table` for tabular data, headings in order; a clickable `div` is a defect.
2. MUST: every control and input has an accessible name or label.
3. MUST: everything works with the keyboard; focus is visible, never trapped, inset on list and table rows, and lands somewhere sensible after a route change.
4. MUST: touch targets are at least 44px high below 1024px.
5. MUST: status changes reach a live region (`role="status"` or `alert`), not only a toast; new Activity rows are announced politely ("2 new").
6. MUST: colour is never the only carrier of status; contrast meets WCAG AA in both themes.
7. MUST: animation respects `prefers-reduced-motion`.
8. MUST: copy says what happened and what next; an error names its cause and offers Retry.
9. SHOULD: axe scans every screen in both themes in e2e.
10. MUST: the terminal dock is a named `<aside aria-label="Terminal">` with a focusable vertical `role="separator"`.

## Enforcement

| Rule | Check |
|---|---|
| 1-3 | `eslint-plugin-jsx-a11y` strict (error) |
| 3-5, 8 | `e2e/z-keyboard.spec.ts`, `e2e/b-routing.spec.ts`, `e2e/z-selection.spec.ts`, `e2e/zz-live.spec.ts` |
| 4, 6 | the browser pass of `verification.md` |
| 7 | `e2e/y-status-line.spec.ts` |
| 9 | `@axe-core/playwright` in `e2e/a-layout.spec.ts` |
| 10 | `e2e/z-terminal.spec.ts`; `packages/ui/test/side-dock.test.ts` |
