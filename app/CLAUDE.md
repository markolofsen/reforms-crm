# app

The TypeScript monorepo (`apps/`, `packages/`, the `hub` CLI).

**The rules in `app/@rules/` are binding. Always follow them, and read the relevant pages in full before you change code here.** Start with `app/@rules/README.md`: it maps each task to its page. Do not work from memory of a page, and do not skim: the pages are short, each rule says why, and each has an Enforcement section naming the check that fails when it is broken.

- Editing `apps/admin` (Next.js 16 App Router, package `@hub/admin`): read the index, then every page it names for your task; `pnpm --filter @hub/admin check` runs the gates (`next typegen`, typecheck, eslint at zero problems, Vitest with the rules test). Before touching navigation (a link, search param, key or title) read `app/@rules/routes-and-url-state.md`: destinations come from `src/routes/paths.ts` and render with `AppLink`, never a string; `next/link` and `next/navigation` are imported only in `src/app`, `src/hooks` and `components/app-link.tsx`. The admin talks to the Hono API over `/api` only: no `@hub/db`, no `"use server"`, no `NEXT_PUBLIC_*`. A client component's first render must not read the viewport, storage or the clock (`state-and-data.md` rule 11).
- A rule that no longer matches reality: change the page in the same change, with the reason. Never route around a rule silently.
- Layers: core never names a custom project, person or address (`@docs/LAYERS.md`).
- Builds and full test runs only at the end of the work, one at a time.
- Paths: every location comes from `@hub/config/paths` (`hubPaths`); `HUB_HOME` is the instance root, unset = this repo. Gate: `apps/installer/test/home-seams.test.ts`; rules README 8.
