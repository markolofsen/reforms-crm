# Admin principles

Scope: what a screen may show and ask; read it before designing or changing a screen. Why: decision 0025; history: decision 0047.

## Rules

1. MUST: the admin shows data and what the agent did; the owner only decides. A control exists only for an owner decision (Send, Skip, Hold, Done, Undo, Stop sending, Edit, Restore, Open); choosing clients is the agent's job.
2. MUST: a screen exists only when it answers a question no other screen answers (`README.md` rule 8a). Overview answers "what needs you": every item that lights a nav dot is an item there with its fix, and a setting the owner chose is never a fault.
3. MUST: list first: under the header line comes the content, never a paragraph, banner or explainer.
4. MUST: no page max-width: pages, panes, lists and tables fill the pane (`@hub/ui/product/shell/page`); only running prose takes the `measure` utility.
5. MUST: logs and lists of records are `@hub/ui/product/list/data-table`, with the outcome in the row; Activity folds one client's same outcome on one day into one line with a count, and never crosses a day.
6. MUST: one list-detail, `@hub/ui/product/list/detail`, for a screen with a subject to open; no resizable panes but the terminal column, a dock beside every screen.
7. MUST: a one-project instance shows no project chrome: no switcher, no project table, and `/` opens Mail.
8. MUST: the brand is the instance config's `name` and `logo` (fallback "Hub"); no per-instance code or style.
9. MUST: settings by frequency: what is set rarely lives in Settings, grouped by what it governs, nothing folded; Settings opens on Sending.
10. MUST: one status sentence per screen, the worst fact with at most one link to its fix; no number appears twice on a screen.
11. MUST: a Mail row is a person in three lines; a view has one door, the sidebar's children with counts, and the header line only names the view on screen (a phone, with no sidebar, keeps it as the View menu); what the sidebar does not choose (filters, brands) is the filter button beside the search, shown only when it has a choice (P134); selecting turns the header line into "N selected · …" in place and never moves the first row.
12. MUST: correspondence: an Open lives on the thing it opens, a setting with what it governs; files no screen lists are on Help.
13. MUST: a section with a menu of its own uses `SectionLayout` and `SectionNav` of `@hub/ui/product`; its selection is the address. The menu is a column from 640px of the layout's own width (compact below 960px, so it stays with the dock panel open) and a row of tabs above the page below that; there is no drawer (owner 2026-11-25).

## Enforcement

| Rule | Check |
|---|---|
| 1, 6, 8 | review; `e2e/z-local-actions.spec.ts`, `e2e/z-terminal.spec.ts`, `e2e/y-activity.spec.ts` |
| 2 | `e2e/y-overview.spec.ts` |
| 3 | `e2e/a-layout.spec.ts` (`FIRST_ROW_MAX_PHONE`, `CONTROL_CAP`) |
| 4 | rules test "no max-w- on a page or pane container" |
| 5 | review |
| 7 | `e2e/b-routing.spec.ts`, `test/routes.test.ts` |
| 9 | `e2e/y-settings.spec.ts`, `e2e/z-agent-tools.spec.ts` |
| 10 | `e2e/y-status-line.spec.ts`, `test/status-line.test.ts` |
| 11 | `e2e/z-selection.spec.ts`, `e2e/a-layout.spec.ts` |
| 12 | `e2e/y-knowledge.spec.ts`; review |
| 13 | `packages/ui/test/section-nav.test.tsx` |
