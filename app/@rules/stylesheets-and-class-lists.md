# Stylesheets and class lists

Scope: Tailwind v4, one stylesheet per app (`src/index.css`, importing `packages/ui/src/styles.css`). History: decision 0047.

## Rules

1. MUST: class strings are static; map a variant to full strings (`cva` or a `Record`), never `bg-${tone}-500`.
2. MUST: v4 arbitrary syntax, `w-(--x)`, never `w-[--x]`.
3. MUST: a property is set in one place; a repeated long class list becomes a component or a named `@utility`.
4. MUST: a selector utilities cannot express, a repeated rule or one a test reads lives in `styles.css`, named for its job.
5. MUST: classes merge only through `cn` of `@hub/ui/cn`.
6. SHOULD: an arbitrary value carries a one-line reason or becomes a named utility.
7. MUST: `styles.css` declares `@source "./"`, and the app lists `@hub/ui` in `transpilePackages`.

## Enforcement

| Rule | Check |
|---|---|
| 1-4, 6 | review |
| 5 | eslint `no-restricted-imports` on `clsx` and `tailwind-merge` (error) |
| 7 | `packages/ui/test/ui.test.ts`; the final production build |
