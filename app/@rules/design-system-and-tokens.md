# Design system and tokens

Scope: components and the look. Adapted from the shared "design system" and "tokens, themes and styles" pages; library roles collapse to coss, and the stylesheet-order rules to the structure of `src/index.css` (compiled by `@tailwindcss/postcss`).

## Rules

1. MUST: reuse order is existing local pattern, then coss primitive (`components/ui`), then a coss particle (skills `coss`, `coss-particles`), then composition of those, then a new local component. Do not invent coss APIs; read the docs.
2. MUST: coss files are copied from `https://coss.com/ui/r/<name>.json` with `@/registry/default/{ui,lib}` rewritten to `@/components/ui`, `@/lib`, and are not hand-edited.
3. MUST: product code uses `ActionButton` (`components/action-button.tsx`: sizes s/m/l, variants primary/secondary/quiet/danger), the field and link primitives. The coss `Button` is imported only by that file (eslint and `test/rules.test.ts`). A raw `<button>`, `<input>`, `<select>`, `<textarea>` or styled `<a>` outside `components/ui` is a defect; if no primitive fits, add one shared component, not a per-site class string.
4. MUST: colors, radii, shadows and spacing come from semantic tokens (`bg-background`, `text-muted-foreground`, `border`). No raw hex, no `text-white`/`bg-black`, no arbitrary `z-[...]`, no inline `style` except a dynamic measure (width of a progress bar).
5. MUST: token values in `index.css` are complete colors, never `hsl(var(--x))`; the `.dark` set is defined next to the light set; every changed surface is checked in light and dark.
6. MUST: `index.css` starts with `@import "tailwindcss"`, then tokens, `@theme inline`, `@layer base`, then named utilities. Nothing imports Tailwind twice; nothing unlayered competes with utilities.
7. MUST: icons come from one library (lucide); an icon-only control has an accessible name.
8. SHOULD: a new shared component passes the admission test: two real consumers, or a stable cross-screen pattern. No component theatre (wrappers that rename one prop).
9. SHOULD: programmatic color (canvas, chart) reads the computed token value; never pass `var()` to a canvas.
10. SHOULD: the theme follows the system; the root layout (`src/app/layout.tsx`) holds the single script that sets `.dark` (documented owner): blocking, inline, run before paint, with `suppressHydrationWarning` on `<html>` because the class is not in the server markup. No component toggles `.dark`.
11. MUST: control heights are the tokens `--control-s/m/l` in `index.css` (32/40/48 px at 1024px and up, 44/44/48 below), reached through `ActionButton` sizes and the `control-s/m/l` utilities for inputs. No `max-lg:h-11` and no per-site touch override. A card or bar shows one `primary` button, never two.
12. MUST: four states never share a look: focus (ring), open (fill and a 3px bar at the start edge), selected (checkbox, blue tint), "I read the checks" (a switch). The shell is the coss `Sidebar` (copied, not edited) with the product's widths set in `features/shell/shell.tsx`, whose frame is `src/app/(shell)/layout.tsx`; there is no top bar, status strip or per-screen header.
13. MUST: below 640px (`md`, the coss sidebar's `max-md`; `--breakpoint-md: 40rem` in `index.css` and `BREAKPOINTS.md` in `use-media-query.ts` are one number) the sidebar is replaced by a bottom tab bar; from 640px it is the icon rail (open from 1280px). A list and its detail are separate screens below 1024px (`max-lg`) and side by side from there. The server cannot know the viewport, so the markup of every width is rendered and CSS (`md:hidden`, `max-md`) takes the other away; the first render never branches on width (`state-and-data.md` rule 11).

## Enforcement

| Rule | Tool |
|---|---|
| 1-2 | review; skill `coss` |
| 3 | eslint `no-restricted-syntax` on raw JSX elements and a restricted import of `@/components/ui/button` outside `action-button.tsx`; `test/rules.test.ts` counts raw elements (0) |
| 10 | `test/rules.test.ts` "the root layout is force-dynamic and owns the one theme script"; light and dark pass in the browser |
| 11-13 | `test/rules.test.ts` (tokens exist, no `max-lg:h-11`, one md breakpoint), `test/card-state.test.ts` (one primary per state), `e2e/a-layout.spec.ts` (44px targets, no sideways scroll) |
| 4-6 | planned grep gates in the rules test (hex, `text-white`, `z-[`, `style={{`), P21; review until then |
| 7-9 | review; light and dark pass in the browser |
