# @hub/knowledge

Per-project knowledge: import (Notion dump or files), FTS5 index, search.

    hub knowledge import <project> --from-dump | --from-files <path>
    hub knowledge index <project>
    hub knowledge search <project> "<query>"
    hub knowledge check <project>

The agent's tools `knowledge_search` and `knowledge_get` (contract: doc 16 section 5) are `hub mcp`'s since P129 A4,
bound to the session's project: `@hub/agent` (`src/mcp/tools/knowledge.ts`) calls the plain functions of
`@hub/knowledge/search`. There is no separate knowledge server any more.

The files are the source (P140 K1). The running server reindexes every active project once at start and again when a file
under its `knowledge/` changes (`src/watch.ts`, debounced; wired in `apps/server/src/knowledge/start.ts`). The reindex is
incremental by content hash and canonical brands (`planProject` and `indexProject` in `src/indexer.ts`), so a `## Brands`
rename or a column added after a row was written heals without a file edit. `src/drift.ts` (`indexDrift`) compares every
indexable file with its row, read only: the doctor row `knowledge.index` fails with the paths that differ and the fix
`hub knowledge index <slug>`.

How a session reaches the entries: through `knowledge_search` and `knowledge_get` (bound to its project), and in an attended
session also by reading, grepping and editing the entry files under `projects/<slug>/knowledge/files/` directly (owner,
2026-11-24; `skills/README.md`, "Reading and writing files"). A background run uses the tools only.
