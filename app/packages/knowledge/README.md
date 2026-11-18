# @hub/knowledge

Per-project knowledge: import (Notion dump or files), FTS5 index, search, MCP server.

    pnpm --filter @hub/knowledge knowledge import <project> --from-dump | --from-files <path>
    pnpm --filter @hub/knowledge knowledge index <project>
    pnpm --filter @hub/knowledge knowledge search <project> "<query>"
    pnpm --filter @hub/knowledge knowledge check <project>

MCP entry (bound to one project by `HUB_PROJECT`): the `knowledge-mcp` server of the core's `config/mcp.json`,

    { "type": "stdio", "command": "app/packages/knowledge/node_modules/.bin/tsx", "args": ["app/packages/knowledge/src/mcp-bin.ts"], "env": { "HUB_PROJECT": "${HUB_PROJECT:-}" } }

An instance's `.mcp.json` and `hub agent`'s session file get these paths made absolute (doctor rows `files.mcp-json`, `mcp.knowledge`).

Tools: `knowledge_search`, `knowledge_get` (contract: doc 16 section 5).
