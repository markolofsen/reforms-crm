# @hub/contract

The shape of every request and reply of the local API, once, as zod schemas. The server validates with them; the admin parses every
reply with them (`read(schema, call)` in `apps/admin/src/lib/api/client.ts`, `app/@rules/state-and-data.md`); the CLI and `@hub/agent`
reuse them. Every object is strict, so a field nobody declared is refused rather than passed on.

| Export | What |
|---|---|
| `./requests`, `./responses`, `./errors` | Every query, body and parameter the API accepts (drafts, marks, status, the send and its ticket, safety rules, a Connections key) and the replies; the one error shape (`invalid`, `not_found`, `wrong_state`, `busy`, `forbidden`). `SETTABLE_STATUSES` has no `sent` |
| `./health` | `API_VERSION`: bumped when a reply changes shape; the admin asks for a server restart when its own number is higher |
| `./activity`, `./overview`, `./instance`, `./connections`, `./agent-tools`, `./sequences` | The Activity table, the Overview, the brand header, Settings ▸ Connections and ▸ Mail, Settings ▸ Agent's Agent tools, the follow-ups |
| `./scheme` | P63 O1: the Hub's parts and how each stands (`GET /api/scheme`, Overview's parts table; patch B's drawing), `worstFirst` |
| `./terminal` | The terminal's sessions and tickets (a preset and a slug only: no command, no path) |
| `./live` | The frames of `GET /api/live` (`hello`, `change`, `reset`) and the topics; they name what changed, never the data (`@docs/core/06-local-admin-app.md`, Live updates) |
| `./focus` | The shared focus the admin publishes (`POST /api/focus`): ids only (`@docs/core/24-terminal.md`, Shared focus) |

Depends only on `@hub/config` and zod. Tests: `pnpm --filter @hub/contract test`.

Update this page when the architecture changes.
