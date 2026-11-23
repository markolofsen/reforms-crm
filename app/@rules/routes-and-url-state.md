# Routes and URL state

Scope: navigation in the admin: real paths, the project in the path with two or more projects (`/lisbon/mail/c/ana%40example.com`) and none with one (`/mail/c/ana%40example.com`). Why: decisions 0014, 0015, 0021; history: decision 0047.

## Rules

1. MUST: `dest` in `src/routes/paths.ts` is the only producer of a destination, typed from the route table's row; each row's pattern is checked against the file tree by `defineRoute` through `typedRoutes`.
2. MUST: the only internal link is `AppLink`, given a `Dest`, never a string or `UrlObject`.
3. MUST: `next/link`, `next/navigation` and `next/router` are imported only by `src/app/**`, `src/hooks/**` and `src/components/app-link.tsx`; `routeOf()` is the one door from address text to a route.
4. MUST: only `hooks/use-search-state.ts` and `lib/external.ts` touch the address bar, and only `lib/storage.ts` `document.cookie`.
5. MUST: the URL is a screen's state: the subject is the path, the view, query and filters are search params.
6. MUST: an unknown path is a real 404; a bad id renders the Not found state with a link to Mail. `REDIRECTS` is empty; an entry needs a reason and a removal condition.
7. MUST: a row that navigates is an `AppLink` with a real `href`.
8. MUST: search is parsed once, in `routes/search.ts`, over the enums of `@hub/config`; a value outside its enum resets to the default.
9. MUST: a filter replaces the history entry, a subject pushes; a default drops its key from the address.
10. MUST: the project is a path segment, never a query. There is one route tree, `app/(shell)/[project]/…`; with one project `src/proxy.ts` rewrites the bare address to it, never redirects. Overview, Help and the instance Settings panes are the projectless routes.
11. MUST: the title comes from the route (`pageTitle()` over `ROUTE_META`); nothing writes `document.title`.
12. MUST: navigating keys come from `SECTIONS` through `use-section-nav`, and every key map goes through `useHotkeys` of `@hub/ui/use-hotkey`.
13. MUST: the skip link focuses `#main` and leaves the address alone.
14. MUST: `src/routes/` imports no React, component, feature, hook or navigation library (`import type { Route } from "next"` excepted).
15. MUST: `routes/table.ts` is the one declaration of the pages: one `defineRoute(path, meta)` row each; a page file is at most 40 lines.
16. SHOULD: a new link, param or key uses `dest`, `useSearch` and `SECTIONS`; never a second router or a `#/` form.
17. MUST: a link to Notion, Telegram or WhatsApp comes from `@hub/contract/local` through `components/links/open-link.tsx`; no such host literal or `target="_blank"` elsewhere.

## Enforcement

| Rule | Check |
|---|---|
| 1 | eslint `no-restricted-syntax`; rules test "no `#/` address anywhere"; `test/paths.types.tsx`; `typedRoutes` |
| 2-3 | eslint `no-restricted-imports`; `test/route-files.test.ts`; rules test "no Server Action" |
| 4 | eslint `no-restricted-globals`; `test/search-state.test.ts` |
| 5, 7, 9, 10 | `e2e/b-routing.spec.ts`; `test/routes.test.ts`; `test/proxy.test.ts`; `test/route-files.test.ts` |
| 6 | `test/routes.test.ts`; `e2e/b-routing.spec.ts` "status policy" |
| 8 | `test/routes.test.ts`; rules test "search is parsed once" |
| 11-12 | `test/hotkeys.test.ts` |
| 13 | `e2e/b-routing.spec.ts`; `e2e/z-keyboard.spec.ts` |
| 14 | eslint `no-restricted-imports` on `src/routes/**` |
| 15 | `test/route-files.test.ts`; rules test "a page.tsx is thin"; `test/paths.types.tsx` |
| 16 | review |
| 17 | rules test "no notion.so … literal"; `packages/contract/test/local.test.ts`; `e2e/z-open-links.spec.ts` |
