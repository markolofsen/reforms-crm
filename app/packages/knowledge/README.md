# @hub/knowledge

Per-project knowledge: import (Notion dump or files), FTS5 index, search, MCP server.

    pnpm --filter @hub/knowledge knowledge import <project> --from-dump | --from-files <path>
    pnpm --filter @hub/knowledge knowledge index <project>
    pnpm --filter @hub/knowledge knowledge search <project> "<query>"
    pnpm --filter @hub/knowledge knowledge check <project>

MCP entry (bound to one project by `HUB_PROJECT`):

    { "command": "pnpm", "args": ["--filter", "@hub/knowledge", "mcp"], "env": { "HUB_PROJECT": "<slug>" } }

Tools: `knowledge_search`, `knowledge_get` (contract: doc 16 section 5).
