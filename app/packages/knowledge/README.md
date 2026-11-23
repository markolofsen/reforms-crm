# @hub/knowledge

Per-project knowledge: import (Notion dump or files), FTS5 index, search.

    hub knowledge import <project> --from-dump | --from-files <path>
    hub knowledge index <project>
    hub knowledge search <project> "<query>"
    hub knowledge check <project>

The agent's tools `knowledge_search` and `knowledge_get` (contract: doc 16 section 5) are `hub mcp`'s since P129 A4,
bound to the session's project: `@hub/agent` (`src/mcp/tools/knowledge.ts`) calls the plain functions of
`@hub/knowledge/search`. There is no separate knowledge server any more.
