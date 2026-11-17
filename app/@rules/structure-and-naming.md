# Structure and naming

Scope: folders, file names and size caps in `app/apps/admin`. Adapted from the shared "code organization and naming" page, condensed; the Next.js `src/app` folder is the framework's and has its own rule (2).

## Rules

1. MUST: a folder answers "what job is done here" in one phrase; `app/` the routes only, `features/<job>/` per screen, `components/` app-level shared UI (shared UI that knows no app is `@hub/ui`), `lib/` typed edges (`lib/api/` the typed client modules), `routes/` the declared destinations, `hooks/` the hooks that read and move through them. No loose pages beside folders.
2a. MUST: `src/app/` holds only the file names Next requires (`page.tsx`, `layout.tsx`, `not-found.tsx`, `error.tsx`, `providers.tsx` for the client providers, `icon.svg`) in route folders; a route group is `(shell)`. A page is at most 40 lines and renders one feature's `section.tsx`; logic, state and markup live in `features/`, `components/`, `hooks/`. `src/proxy.ts` is the one file beside `app/` that Next names, and it must stay in `src/` (at the app root Next ignores it).
2. MUST: a source file is at most 300 lines (tests excluded; in `packages/ui` the coss copies in `src/ui` are excluded too). There is no allow-list: a file that grows past the cap is split.
3. SHOULD: a component is at most 150 lines; extract subcomponents and hooks (`use-*.ts`) when it grows. A hook that two places repeat (list shortcuts) is shared.
4. MUST: at most 8 source files per directory (`features/shell` is at the cap: the shell, its frame, the sidebar, the tab bar, the split view, the project switcher, the status footer and the icons); `src/app` (framework file names) and, in `packages/ui`, `src/ui` (the coss copies) are outside it. Reaching the cap means a seam exists, find it before adding a ninth.
5. MUST: file names are kebab-case and state the subject (`draft-block.tsx`); a folder prefix is dropped inside (`bulk/batch-list.tsx`, not `bulk-batch-list.tsx`). One name means one thing: two different `Detail` components in one app is a defect. A route has one name: `routes/meta.ts` (`drafts.item`), `routes/paths.ts` (`paths.drafts.item`), the folder under `src/app/(shell)/` and a section id in `routes/sections.ts` agree; the client entry of a section is `features/<job>/section.tsx` and binds to that id.
6. MUST: no dead barrels (`index.ts` that only re-exports); import from the file that owns the symbol.
7. SHOULD: comments say why, not what; no narration of the next line.

## Enforcement

| Rule | Tool |
|---|---|
| 2 | eslint `max-lines` (error); the number and the way lines are counted live once in `packages/config/src/lint-limits.mjs`, and `test/rule-citations.test.ts` checks this page states them |
| 2a | `test/rules.test.ts` "a page.tsx is thin"; `test/route-files.test.ts` (the tree and the typed layer agree); rules test "proxy.ts lives in src/" |
| 3 | eslint `max-lines-per-function` (error; `packages/config/src/lint-limits.mjs`) |
| 4 | `test/rules.test.ts` "directory size" (8) and "hooks/ holds at most 8 files" |
| 6 | `test/rules.test.ts` "no dead barrel" |
| 1, 5, 7 | review |
