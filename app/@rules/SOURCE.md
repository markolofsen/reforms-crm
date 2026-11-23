# Provenance of the app rule pages

Adapted, not linked, from a general set of frontend rules (Next.js, generated clients, providers): `app/@rules` is core and cannot depend on one owner's home directory. Drift control is a manual diff against that set; no test needs the source.

The adaptation: a local Next.js admin with a Hono API behind a rewrite, loopback bind, `proxy.ts`, no Server Actions, coss on Base UI, Playwright and Vitest instead of a workbench. Originals of this project: `README.md`, `admin-principles.md`, `approval-and-capabilities.md`, `live-edit.md`, `skills.md`.

Adapted pages: `accessibility.md`, `agent-guardrails.md`, `architecture-and-ownership.md`, `design-system-and-tokens.md`, `generated-api-clients.md`, `routes-and-url-state.md`, `state-and-data.md`, `structure-and-naming.md`, `stylesheets-and-class-lists.md`, `typing.md`, `ui-composition.md`, `ui-specifications.md`, `verification.md`.
