# Provenance of the app rule pages

These pages are copied and adapted from a general set of frontend rules (Next.js, generated API clients, provider composition, and Radix), not linked:
`app/@rules` is core and is handed to other people, so it cannot depend on a path under one owner's home directory.
Drift control is a manual diff against that set about once a quarter; no test needs the source to exist. The current refresh also uses the Django CFG checkout's `projects/solution/@rules/frontend` as a reference; it is evidence for maintainers only and must not become a runtime dependency.

What changed in the adaptation, per page: the admin is a local Next.js app (App Router) with a Hono API behind a rewrite, so
generated-client, provider and store material was adapted rather than dropped; layers became `app` / `routes` / `hooks` / `lib` / `components` /
`features`; `next.config.ts`, `proxy.ts`, the loopback bind and the API boundary are local; Radix became Base UI (coss);
workbench and stories were replaced by Playwright and Vitest; verification is `pnpm check` and `pnpm e2e` (a `next start`
build on its own `distDir`). `README.md`, `admin-principles.md`, `live-edit.md` and `skills.md` are originals of this project.

Where the general set and these pages differ, these pages state what the shipped code shows: loopback bind, `proxy.ts`,
no Server Actions, an API behind a rewrite, generated JSON operations through `@hub/api`, hooks and links under one typed layer, and protocol-specific adapters outside codegen.

Adapted pages: `accessibility.md`, `agent-guardrails.md`, `architecture-and-ownership.md`, `design-system-and-tokens.md`, `generated-api-clients.md`, `routes-and-url-state.md`, `state-and-data.md`, `structure-and-naming.md`, `stylesheets-and-class-lists.md`, `typing.md`, `ui-composition.md`, `ui-specifications.md`, `verification.md`.
