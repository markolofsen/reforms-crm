# State and data

Scope: where each kind of state lives in the admin. Adapted from the shared "state and data" page; the generated-client, store and SWR lanes collapse into TanStack Query (pull data) plus the URL plus component state. The app is a client of the Hono API: server components fetch nothing (P32 N3 tried one server-fetched first list and kept none).

## Rules

1. MUST: classify before writing. Server data lives in TanStack Query; navigation state (screen, subject, filter) lives in the URL; ephemeral UI state (an expanded row, a draft in an input) lives in the component. A fourth place needs a reason written in the PR. URL state is not query-cache state and not storage: the address holds screen, subject, filter and project; the remembered project is the cookie `hub_project` (so `proxy.ts` can read it before a page renders) and the shortcuts and rail switches are `localStorage`, both behind `lib/storage.ts` (`routes-and-url-state.md`).
2. MUST: a query key names the resource and every input that changes the result. Two components reading one resource use one key factory.
3. MUST: a mutation invalidates or updates the canonical query key, never patches a component copy.
4. MUST: one boundary reads an API reply: `read(schema, call)` in `lib/api/client.ts` sends the call, retries once on a busy database, turns a refusal into an `ApiFailure` carrying the server's own sentence, and parses a success with a `@hub/contract` schema, so a stale server fails with a sentence instead of a render crash. Error bodies are parsed, not cast; callers get types from the contract schema, never from a hand-written shape or a cast.
5. MUST: every list and mutation has all of: loading, empty, error (with Retry), stale or refetching, and partial result where the server can return one. A toast is never the only record of an outcome.
6. MUST: a mutating control disables while pending (no double submit) and reports the failure inline.
7. MUST: browser storage and the project cookie are touched in one module (`lib/storage.ts`), with try/catch, because they can throw or come back empty. Keys are defined there, never as a literal at a call site. A stored value is read through `useStored` / `useRememberedProject` (`useSyncExternalStore`), never in a `useState` initializer (rule 11).
8. SHOULD: optimistic updates roll back on error and say so.
9. SHOULD: derive instead of storing; no `useEffect` that copies props or query data into state.
10. SHOULD: time-sensitive data states its freshness (refetch interval or "updated N min ago").
11. MUST: the first render is stable. The server renders HTML with no viewport, storage, cookie or clock, so a client component's first render must produce the same markup there and in the browser, or hydration fails (the largest new bug class on Next, research 19 section 6). Read the viewport, storage, the cookie and the clock through `useSyncExternalStore` with a server snapshot (`useMediaQuery` returns `false`, `useStored` and `useRememberedProject` return `null`), or only after mount (the shell gates its data views behind the frame's loading state, so `useClock`, `useMediaQuery` and the sidebar state run after the gate). Layout that depends on width uses CSS breakpoints, never a width branch in the first render. Never `Date.now()`, `Math.random()`, `window` or `localStorage` in render or in a `useState` initializer.
12. MUST: Next caches no API data. Replies live only in the Query cache (`gcTime` as configured); the root layout is `force-dynamic`; the mail body of a draft is read live on every open and kept nowhere (decision 0013). A server-fetched first paint is not used; adding one needs a written reason and a single source of truth for that list.

## Enforcement

| Rule | Tool |
|---|---|
| 1-3 | review |
| 4 | eslint `consistent-type-assertions` (never, error) and the `@hub/contract` parser in `read()`; `test/api-client.test.ts` |
| 5-6 | e2e scenarios named by state (see `ui-specifications.md`) |
| 7 | eslint `no-restricted-globals` on `localStorage`/`sessionStorage` (error); rules test "document.cookie is touched only by lib/storage.ts" |
| 8-10 | review |
| 11 | rules test "stable first render" (no `useState` initializer reads the window, document, storage, media query or clock; `matchMedia` only in `use-media-query`); eslint `no-restricted-properties` (`Date.now`, `Math.random`); `e2e/c-console.spec.ts` (every route loads cold with no console error or hydration message at three widths; the server HTML is the loading state, never data or a viewport branch) |
| 12 | `e2e/d-build.spec.ts` (every route is dynamic, the build needs no API); review for the live mail body |
