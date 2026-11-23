# @hub/contract

The shape of every request and reply of the local API, once, as zod schemas. The server validates with them; the admin parses every
reply with them (`read(schema, call)` in `apps/admin/src/lib/api/client.ts`, `app/@rules/state-and-data.md`); the CLI and `@hub/agent`
reuse them. Every object is strict, so a field nobody declared is refused rather than passed on.

| Export | What |
|---|---|
| `./requests`, `./responses`, `./errors` | Every query, body and parameter the API accepts (drafts, marks, status, the send and its ticket, safety rules, a Connections key) and the replies; the one error shape (`invalid`, `not_found`, `wrong_state`, `busy`, `forbidden`). `responses` remains a compatibility barrel while bounded exports migrate. `SETTABLE_STATUSES` has no `sent` |
| `./health` | `API_VERSION`: bumped when a reply changes shape; the admin asks for a server restart when its own number is higher |
| `./activity`, `./overview`, `./instance`, `./connections`, `./agent-tools`, `./sequences` | The Activity table, the Overview, the brand header, Settings ▸ Connections and ▸ Mail, Settings ▸ Agent's Agent tools, the follow-ups |
| `./knowledge` | P70: the Knowledge table (`GET /api/projects/:slug/knowledge`): `knowledgeEntryDto` (the Open key, title, audiences, brands, status; no body, no absolute path), `knowledgeListDto` with every view's count, `entryStatus` (expired, not approved, expiring within 14 days, approved) and `inView` |
| `./scheme` | P63 O1: the Hub's parts and how each stands (`GET /api/scheme`, Overview's parts table; patch B's drawing), `worstFirst` |
| `./terminal` | The terminal's sessions and tickets (a preset and a slug only: no command, no path) |
| `./live` | The frames of `GET /api/live` (`hello`, `change`, `reset`) and the topics; they name what changed, never the data (`@docs/core/06-local-admin-app.md`, Live updates) |
| `./focus` | The shared focus the admin publishes (`POST /api/focus`, `schema: 2`, P72): the route id and title, and refs (`<kind>:<id>`, `REF_KINDS`, `parseRef`, from `src/refs.ts`): subject, pointed, selected, the window on screen, the view; ids only (`@docs/core/24-terminal.md`, Shared focus) |
| `./messengers`, `./messenger-panel` | P71: the Telegram user account (state, login steps, the dialog picker and the link: M1) and the Messengers section (M3): the panel's linked chats with what is owed and the open draft, Edit, Skip, a chat's rules, the link picker's client lookup. Refs `chat:<id>` and `mdraft:<id>` are its rows |
| `./sending` | Send audit rows, dry-run previews, single-use tickets, batch plans/runs and cancellation responses; send-door DTOs stay separate from review/project responses |
| `./mail` | Mail draft projection and its live-read DTO; the server-side Mail bridge remains outside the generated client and send door |
| `./review` | Review and batch response schemas, timeline/history projections and warning acknowledgements; the bounded entry point for Mail review facades and server review routes |
| `./messenger` | Messenger channel vocabulary and owner-confirmed send-door DTOs; panel reads remain under `./messenger-panel` |
| `./composer` | The channel-neutral owner composer state union used by Mail and Messengers; it keeps editing, saving, saved, blocked, error and unavailable states explicit without owning mutations or send permissions |
| `./language` | The browser-safe reply-language detector shared by Mail's server resolver and Markdown composer; quoted lines never affect the language |
| `./notion` | The shared Notion identity state used by Mail and Messenger contact surfaces; it distinguishes a resolved page, a known missing page and an unavailable lookup |
| `./pointer` | P72: the agent's pointer (`highlight` in `hub mcp` writes `state/pointer.json`; `GET /api/pointer`): up to 5 refs, a note of 80 characters, 30 s, the outcomes posted back once |

Depends only on `@hub/config` and zod. Tests: `pnpm --filter @hub/contract test`.

Update this page when the architecture changes.
