# Typing

Scope: keep the types truthful. History: decision 0047.

## Rules

1. MUST NOT write `any`, `@ts-ignore`, `as any` or `as unknown as T`; `@ts-expect-error` only with a description and a cause outside the repo.
2. MUST NOT use `as T` or a non-null `!` in hand-written source; narrow with a guard, a schema's `safeParse`, a union or a named throw. `as const` is allowed.
3. MUST: `import type` for type-only imports; a page types its props with the generated `PageProps<…>`.
4. MUST: states are unions, not combinable optional fields.
5. MUST: closed vocabularies are unions with a total `Record<Union, string>` label map.
6. MUST: `noUncheckedIndexedAccess` stays on.
7. SHOULD: derive types from their source (`@hub/contract`, `@hub/config`).
8. MUST: the coss copies are exempt from rule 2, not from rule 1.
9. MUST: the one assertion on a generated response is inside `@hub/api/runtime`, validated at once by `readGenerated`.

## Enforcement

| Rule | Check |
|---|---|
| 1 | eslint `no-explicit-any`, `ban-ts-comment` |
| 2 | eslint `consistent-type-assertions` (never), `no-non-null-assertion` |
| 3 | eslint `consistent-type-imports`; `verbatimModuleSyntax` |
| 4-7, 9 | `tsc`; `test/paths.types.tsx`; review |
| 8 | review |
