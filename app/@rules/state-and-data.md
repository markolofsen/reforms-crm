# State and data

Scope: where each kind of state lives in the admin. History: decision 0047.

## Rules

1. MUST: server data lives in TanStack Query, navigation state (screen, subject, filter, project) in the URL, ephemeral UI state in the component. The remembered project is a cookie, viewing preferences `localStorage` (rule 7), except the shell's layout (the rail's pin, the terminal column's open state and width, the last breakpoint), which is the `hub_shell` cookie so the server lays the first paint out as the last page ended (P128 X8, `lib/shell-prefs.ts`); a fourth place needs a written reason.
2. MUST: a query key names the resource, then the project, then every input, and is built only by `keys` in `lib/cache/keys.ts`.
3. MUST: a mutation invalidates or updates the canonical key, never a component copy.
4. MUST: one boundary reads a reply: `read(schema, call)` or `readGenerated` in `lib/api/client.ts`, which own retry, error normalisation and parsing; types come from the `@hub/contract` schemas, never a cast.
4a. MUST: generated operations own no Query or domain state; the root QueryClient and `keys` are the only cache owners.
4b. MUST: the data modules `lib/data/*` own `useQuery`, `useMutation`, `useQueryClient`, the keys and the facades; features and components reach server data only through them (exempt: `OWN_TRANSPORT`). A write names the live topics it touches through `useCommand` of `lib/cache/topics.ts`, which invalidates exactly their `TOPIC_KEYS`.
4c. MUST: composer state is the discriminated `ComposerState` of `@hub/contract/composer`, mapped through `composerStateOf`; no feature infers it from loose flags.
5. MUST: every list and mutation has loading, empty, error with Retry, stale, and partial where the server can return one; a read draws them through `QueryView` (`components/state-views.tsx`). A toast is never the only record of an outcome.
6. MUST: a mutating control disables while pending and reports failure inline; a setting that saves on change is a `SettingSwitch`, a field that saves on leave a `CommitField`.
7. MUST: storage and the two cookies (project, shell) are touched only in `lib/storage.ts`, with try/catch, keys defined there (the shell cookie's format in `lib/shell-prefs.ts`, which the shell layout also parses on the server); `hub-theme` belongs to `next-themes` alone. A stored value is read through `useStored`, `useRememberedProject` or `useShellPrefs`, a written one on change.
8. SHOULD: an optimistic update rolls back on error and says so.
9. SHOULD: derive instead of storing; no `useEffect` that copies props or query data into state.
10. SHOULD: time-sensitive data states its freshness ("Live", "Reconnecting", "updated N min ago").
11. MUST: the first render is stable: no viewport, storage, cookie or clock in render or a `useState` initializer. Read them through `useSyncExternalStore` with a server snapshot, or after mount; width-dependent layout uses CSS breakpoints. The shell's server snapshot is the layout's read of `hub_shell` (`ShellPrefsContext`, `useAtLeast`), never a client read.
12. MUST: Next caches no API data; a draft's mail body is read live on open and kept nowhere (decision 0013); no server-fetched first paint without a written reason.
13. MUST: live updates invalidate, never push (decision 0028): one EventSource per browser, only in `lib/cache/live.ts`; a frame invalidates its topics' `TOPIC_KEYS`. No screen adds its own `refetchInterval` except a running batch's progress.
14. MUST: the shared focus is published, not URL state: derived by `features/focus/derive.ts` (generic over the route table), posted only from `lib/api/terminal.ts`, refs only, never stored or in the address; the server stamps the time.

## Enforcement

| Rule | Check |
|---|---|
| 1, 3, 8-10 | review |
| 2, 13 | rules test "one key factory, one live stream"; `test/live.test.ts`; `test/live-polls.test.ts`; `e2e/zz-live.spec.ts` |
| 4, 4a | eslint `consistent-type-assertions`; `test/api-client.test.ts` |
| 4b | eslint `@typescript-eslint/no-restricted-imports` outside `OWN_TRANSPORT`; `test/topics.test.ts` |
| 4c | `packages/contract/test/composer.test.ts` |
| 5-6 | rules test "one view of a read"; the scenarios of `ui-specifications.md` |
| 7 | eslint `no-restricted-globals`; rules test "document.cookie is touched only by lib/storage.ts"; `test/shell-prefs.test.ts` |
| 11 | rules test "stable first render"; eslint `no-restricted-properties`; `e2e/c-console.spec.ts` |
| 12 | `e2e/d-build.spec.ts`; review |
| 14 | rules test "the shared focus (P51) is posted only from lib/api/terminal.ts"; `test/focus.test.ts`; `e2e/z-focus.spec.ts` |
