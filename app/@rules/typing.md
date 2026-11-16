# Typing

Scope: the type system is the one gate that reads types across the whole frontend; keep it truthful. Adapted from the shared "typing and type safety" page.

## Rules

1. MUST NOT write `any`, `@ts-ignore`, or `as any` / `as unknown as T`. `@ts-expect-error` only with a description and only where the cause is outside the repo.
2. MUST NOT use a type assertion (`as T`) or non-null `!` in hand-written source. Narrow instead: a guard function, a contract schema's `safeParse`, a discriminated union, an early return that throws a named error. `as const` is allowed. An address text becomes a `Route` only through `routeOf()` (`routes/typed.ts`), a guard, never a cast.
3. MUST: `import type` (or inline `type`) for type-only imports; this is what keeps `@hub/server` out of the bundle. A page file types its props with the generated global `PageProps<"/drafts/[id]">` (from `next typegen`) and awaits `params` and `searchParams`, which are Promises in Next 16.
4. MUST: model states as unions (`{ status: "error"; message: string } | ...`), not as optional fields that can combine into impossible values.
5. MUST: closed vocabularies (intents, statuses, tones) are unions with a total label map (`Record<Union, string>`), so adding a member fails the build.
6. MUST: `noUncheckedIndexedAccess` stays on; handle the `undefined`.
7. SHOULD: derive types from the source of truth (the `@hub/contract` schemas and `@hub/config` enums, `typeof` of a const list) instead of restating them. A route is typed by the framework (`typedRoutes`) for its path and by `paths.ts` for its search; both fail `tsc`, not a test run.
8. coss files in `components/ui` are copied, not hand-edited; they are exempt from 2 but not from 1.

## Enforcement

| Rule | Tool |
|---|---|
| 1 | eslint `no-explicit-any`, `ban-ts-comment` at error |
| 2 | eslint `consistent-type-assertions` (never) and `no-non-null-assertion` at error; `test/rules.test.ts` `typeAssertion` and `nonNull` (AST count, hard zero) |
| 3 | eslint `consistent-type-imports`; `verbatimModuleSyntax` in tsc |
| 4-7 | `tsc` (strict, `noUncheckedIndexedAccess`); `test/paths.types.tsx` (`@ts-expect-error` lines for the builders and the typed-route door); review |
