# Design system and tokens

Scope: components and the look; `packages/ui/src/styles.css`, imported by the admin's `src/index.css`. History: decision 0047.

## Rules

1. MUST: reuse in order: a local pattern, a coss primitive (`@hub/ui`), a coss particle, a composition of those, then a new component. Never invent a coss API.
2. MUST: coss files are copied from the registry into `packages/ui/src/ui` with relative imports, and never hand-edited.
3. MUST: product code uses `ActionButton` (`@hub/ui/product/action-button`) and the field and link primitives; the coss `Button` is imported only by that file, and a raw `<button>`, `<input>`, `<select>`, `<textarea>` or styled `<a>` outside the coss copies is a defect.
4. MUST: colours, radii, shadows and spacing are semantic tokens: no raw hex, `text-white`, `bg-black`, arbitrary `z-[…]` or inline `style` but a dynamic measure.
5. MUST: token values are complete colours; the `.dark` set sits beside the light set, and both are looked at.
6. MUST: `index.css` imports Tailwind first, then `styles.css`, then only the app's own geometry; `styles.css` never imports Tailwind.
7. MUST: icons are lucide (channel marks through `createLucideIcon`); an icon-only control has an accessible name.
8. SHOULD: a new shared component has two real consumers or a stable cross-screen pattern; no wrapper that renames one prop.
9. SHOULD: canvas or chart colour reads the computed token, never `var()`.
10. MUST: the theme is set only through `@hub/ui/product/shell/theme` (`next-themes`, `storageKey="hub-theme"`), mounted once by the root layout; no other file toggles `.dark`.
11. MUST: control heights are the tokens `--control-s/m/l`, reached through `ActionButton` sizes and the `control-*` utilities; no per-site touch override; a card shows one primary button.
12. MUST: focus (ring), open (fill and a start-edge bar) and selected (checkbox and tint) never share a look.
13. MUST: one breakpoint, `md` (640px; `--breakpoint-md` and `BREAKPOINTS.md` are one number): a bottom tab bar below it, the icon rail from it.
14. MUST: one heading style in a page, `SectionTitle` of `@hub/ui/product/shell/page`; no capitals eyebrow.

## Enforcement

| Rule | Check |
|---|---|
| 1-2, 4-9, 12, 14 | review; the skill `coss`; light and dark in the browser |
| 3 | eslint `no-restricted-syntax` and the `@hub/ui/button` import ban |
| 10 | rules test "the root layout is force-dynamic and mounts the ThemeProvider"; `e2e/c-console.spec.ts` |
| 11, 13 | `packages/ui/test/ui.test.ts`; rules test "no per-component touch hack"; `test/card-state.test.ts`; `e2e/a-layout.spec.ts` |
