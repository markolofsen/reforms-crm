# notion-dump

A read-only Notion backup for reforms-crm (package `@hub/notion`, `app/packages/notion`). A deterministic job:
no model, no Hub, no OAuth session. It uses `@notionhq/client` with an internal integration token and has no code path
that writes to Notion: the reader interface (`src/types.ts`) holds three read methods and nothing else.

```
pnpm --filter @hub/notion notion-dump check   acme          # can the token see every database?
pnpm --filter @hub/notion notion-dump dump    acme          # -> projects/acme/dumps/YYYY-MM-DD/
pnpm --filter @hub/notion notion-dump restore acme --dry-run
pnpm --filter @hub/notion notion-dump leads   acme          # what waits in Leads: needs reply, overdue, won without a client
pnpm --filter @hub/notion notion-dump diff    leads --live live.json   # the pack's schema vs a live data source; exit 2 on a difference
pnpm --filter @hub/notion typecheck && pnpm --filter @hub/notion test
```

Flags: `--out DIR` (dump root, default `<project>/dumps`), `--date`, `--only clients,leads`, `--rps 3`, `--no-reuse`,
`--token-file NAME` (a token file other than `notion-token` in the secrets folder; the tool reads it, the caller never does), `--from DATE|PATH` and `--json` (restore). `hub backup --apply` copies each project's newest existing dump into a snapshot; only `hub backup --apply --notion-dump` runs a live dump first (decision 0023, `@docs/setup/access.md`). Exit codes: 0 ok, 1 error, 2 a database failed, 3 no token, 64 usage.

## project.md

One file per project, in the project folder. A heading names the project; each database is one list item
`- <slug>: <data source id>` under `## Notion databases`. Everything else is prose or tables; a `- word: value` item elsewhere is an error. Ids are the `collection://` ids of the Notion MCP (data
source ids), dashes optional. A list item with a bad id is an error, never skipped.

```markdown
# acme

Teamspace "CRM: acme". Notes go in plain paragraphs.

## Notion databases

- clients: 00000000-0000-0000-0000-955284342101
- leads: 00000000-0000-0000-0000-705240741680
```

`projects/<slug>/project.md` lists the project's CRM databases. A new
project is a new folder under `projects/` with its own `project.md`; dumps stay inside it and are git-ignored (they hold CRM data).

## Dump layout

```
dumps/2026-11-14/
  manifest.json            counts, per-database and total sha256, errors; written last
  clients/schema.json      properties and select options as Notion returned them
  clients/index.md         title, page id, last edited
  clients/pages/<id>.json  the page object (properties, ids, timestamps, parent)
  clients/pages/<id>.md    the body from pages.retrieveMarkdown
```

- Idempotent: same Notion state, same bytes, same hash. Keys are sorted, pages are sorted by id, and the expiring
  signature of hosted-file URLs is removed. The manifest has no timestamp; the folder name is the date.
- Incremental: a page whose `last_edited_time` is unchanged since the previous complete dump keeps its markdown, so a
  daily run costs one list call per 100 rows plus one call per edited page. `--no-reuse` refetches everything.
- A folder without `manifest.json` is an unfinished dump: nothing reads it. One failing database is recorded in the
  manifest (`error`) and the others are still dumped.
- A body the API cut short ends with `<!-- notion-dump: truncated ... -->` and is counted in the manifest.
- Rate limit: at most 3 requests per second (`--rps`), and the SDK retries 429 and 529 with `Retry-After`.

## restore --dry-run

Compares the newest complete dump (or `--from`) with the live databases and prints what a restore would do: pages gone
from Notion (would be recreated, with the properties the API cannot write and the relations that need an old-id to
new-id map), pages that differ (left alone, listed by property), pages only in Notion, and schema drift (missing
property, changed type, missing select options). Matching is by page id. It reads schemas and page lists only.
Applying a restore is not implemented; without `--dry-run` the command refuses.

## Token

The token is read from `NOTION_TOKEN`, else from `state/secrets/notion-token` (git-ignored; `HUB_CONFIG_DIR` overrides; the token alone, `chmod 600`). It is never printed or written to a dump. This tool needs the **Read content** capability only. How to create the integration, what to share with it and how to verify it: [`@docs/setup/access.md`](../../../@docs/setup/access.md). Then run `pnpm notion-dump check`.
