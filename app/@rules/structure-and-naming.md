# Structure and naming

Scope: folders, file names and size caps in `app/apps/admin`. History: decision 0047.

## Rules

1. MUST: a folder names one job: `app/` routes, `features/<job>/` one screen job, `components/` app-level shared UI, `lib/` typed edges, `routes/` destinations, `hooks/` the hooks over them.
2a. MUST: `src/app/` holds only Next's file names; a page is at most 40 lines and renders one feature's `section.tsx`. `src/proxy.ts` stays in `src/`.
2. MUST: a source file is at most 300 lines, blank and comment-only lines not counted (tests and the coss copies in `packages/ui/src/ui` excluded); a file past the cap is split, never listed.
3. MUST: a function is at most 150 lines; extract subcomponents and hooks.
4. MUST: at most 8 source files per directory outside `src/app` and the coss copies; at the cap, find the seam before adding a ninth.
5. MUST: file names are kebab-case and state their subject, without the folder's prefix; one name means one thing; a route's id, path, folder and section id agree.
6. MUST: no barrel `index.ts` that only re-exports.
7. SHOULD: comments say why, not what.

## Enforcement

| Rule | Check |
|---|---|
| 2, 3 | eslint `max-lines` and `max-lines-per-function` (errors); the numbers live once in `packages/config/src/lint-limits.mjs`, and `test/rule-citations.test.ts` checks this page states them |
| 2a | rules test "a page.tsx is thin"; `test/route-files.test.ts` |
| 4, 6 | rules test "directory size" and "no dead barrel" |
| 1, 5, 7 | review |
