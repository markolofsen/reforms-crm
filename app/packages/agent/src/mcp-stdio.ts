import { hubPaths } from "@hub/config/paths";
import { createRepos, openDbReadOnly } from "@hub/db";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createHubMcpServer } from "./mcp";

/**
 * `hub mcp`: the hub's read-only MCP server on stdio (P51). Env: `HUB_HOME`, `HUB_PROJECT` (every tool refuses without it),
 * `HUB_DB` optional. The database is opened read-only. Nothing but the protocol may reach stdout.
 */
export async function serveHubMcp(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const paths = hubPaths({ env });
  const handle = openDbReadOnly(paths.db);
  const server = createHubMcpServer(createRepos(handle.db), { hubProject: env.HUB_PROJECT?.trim() || undefined, focusFile: paths.focus });
  process.on("SIGINT", () => handle.close());
  await server.connect(new StdioServerTransport());
}
