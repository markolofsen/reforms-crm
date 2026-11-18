# Stylesheets and class lists

Scope: where styling lives, in Tailwind v4 with one stylesheet per app (`src/index.css`, imported once by the root layout; it imports the package's `packages/ui/src/styles.css`) compiled by the PostCSS plugin `@tailwindcss/postcss` (`postcss.config.mjs`). Adapted from the shared "stylesheets and class lists" page.

## Rules

1. MUST: class strings are static. No `bg-${tone}-500`; map a variant to full class strings (`cva` or a `Record`). Tailwind scans text and generates nothing for an assembled name.
2. MUST: v4 arbitrary-value syntax: `w-(--x)`, not v3 `w-[--x]` (compiles to nothing).
3. MUST: one owner per element: a class that sets a property is set in one place. A long repeated class list (the same 8 utilities on 9 anchors) becomes a component or a named `@utility` in `styles.css`, not copies.
4. MUST: move a rule into `styles.css` when it uses a selector utilities cannot express (pseudo-elements, vendor scrollbars), repeats across files, or must be read by a test. Name it for its job (`scroll-strip`, `measure`).
5. MUST: merge classes only through `cn` from `@hub/ui/cn`.
6. SHOULD: an arbitrary value (`max-w-[100vw]`, `[scrollbar-width:none]`) is the exception and carries a one-line reason, or becomes a named utility.
7. MUST: `styles.css` declares `@source "./"` so Tailwind scans the package's class strings (it ignores `node_modules`, and the package is reached through that symlink); the app's `next.config.ts` lists `@hub/ui` in `transpilePackages`. Check a production build: dev generates on demand and hides a missing `@source`. An app imports the stylesheet by its relative path (`../../../packages/ui/src/styles.css`; an instance app: `../../core/app/packages/ui/src/styles.css`).

## Enforcement

| Rule | Tool |
|---|---|
| 1-2 | review; clean today |
| 3-4, 6 | review |
| 5 | eslint `no-restricted-imports` on `clsx` and `tailwind-merge` outside `packages/ui/src/cn.ts` (error, in the admin and in the package) |
| 7 | `packages/ui/test/ui.test.ts` (`@source` present, no Tailwind import); production `next build` at the end of the work (the e2e run builds it) |
