# @hub/ui

The one shared UI package of the monorepo: the coss copies, the product primitives, `cn` and the tokens. The admin imports it; any instance app
(decision 0018) imports it the same way. It imports no app, no other `@hub/*` package, no `next/*` and no `@/` alias
(`test/ui.test.ts` and `eslint.config.mjs` hold that).

## What is in

| Path | What | Lint |
|---|---|---|
| `src/ui/*.tsx` | 28 coss copies, not hand-edited (`https://coss.com/ui/r/<name>.json`, `@/registry/default/{ui,lib}` rewritten to `./x` and `../cn`) | typing bans off; direction and `use server` bans on |
| `src/product/*.tsx` | `action-button` (three sizes, four variants), `field` (`Field`, `Progress`), `filter-chips` | every rule |
| `src/cn.ts` | `cn`, the one user of `clsx` and `tailwind-merge` | direction |
| `src/use-media-query.ts` | coss copy with one product edit (`md: 640`) | caps off |
| `src/styles.css` | tokens (`:root`, `.dark`), `@theme`, `@layer base`, the `control-*` and `scroll-strip` utilities, `@source "./"`; no Tailwind import | n/a |

## Use it

No barrel: import from the file that owns the symbol.

```ts
import { Button } from "@hub/ui/button";
import { ActionButton } from "@hub/ui/product/action-button";
import { cn } from "@hub/ui/cn";
```

An app adds three things:

1. `"@hub/ui": "workspace:*"` in its `package.json`.
2. `transpilePackages: ["@hub/ui"]` in `next.config.ts` (the package ships TypeScript source).
3. In its one stylesheet, Tailwind first, then the package (relative path; in an instance app `../../core/app/packages/ui/src/styles.css`):

```css
@import "tailwindcss";
@import "../../../packages/ui/src/styles.css";
```

The `@source "./"` inside `styles.css` makes Tailwind scan the package's class strings. Without it a production build silently drops them
(dev generates on demand, so dev looks fine): always check a production build.

## What does not belong here

A component that imports a route, a hook, the API client or storage of an app (`app-link`, `not-found`, `key-help`, `state-views` in the admin).
It moves here when it imports nothing from `@/`. Rules: `app/@rules/architecture-and-ownership.md` rules 2 and 15.
