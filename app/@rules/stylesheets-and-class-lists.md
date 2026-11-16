# Stylesheets and class lists

Scope: where styling lives, in Tailwind v4 with one stylesheet (`src/index.css`), imported once by the root layout and compiled by the PostCSS plugin `@tailwindcss/postcss` (`postcss.config.mjs`). Adapted from the shared "stylesheets and class lists" page.

## Rules

1. MUST: class strings are static. No `bg-${tone}-500`; map a variant to full class strings (`cva` or a `Record`). Tailwind scans text and generates nothing for an assembled name.
2. MUST: v4 arbitrary-value syntax: `w-(--x)`, not v3 `w-[--x]` (compiles to nothing).
3. MUST: one owner per element: a class that sets a property is set in one place. A long repeated class list (the same 8 utilities on 9 anchors) becomes a component or a named `@utility` in `index.css`, not copies.
4. MUST: move a rule into `index.css` when it uses a selector utilities cannot express (pseudo-elements, vendor scrollbars), repeats across files, or must be read by a test. Name it for its job (`scroll-strip`).
5. MUST: merge classes only through `cn` from `@/lib/utils`.
6. SHOULD: an arbitrary value (`max-w-[100vw]`, `[scrollbar-width:none]`) is the exception and carries a one-line reason, or becomes a named utility.
7. SHOULD: if UI ever lives in `packages/ui`, `index.css` declares `@source` for it and `next.config.ts` lists the package in `transpilePackages`; then check a production build, since dev generates on demand.

## Enforcement

| Rule | Tool |
|---|---|
| 1-2 | review; clean today |
| 3-4, 6 | review |
| 5 | eslint `no-restricted-imports` on `clsx` and `tailwind-merge` outside `lib/utils.ts` (warn) |
| 7 | production `next build` at the end of the work (the e2e run builds it) |
