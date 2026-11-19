import { hubPaths } from "@hub/config/paths";
import { bumpTopicIn, createRepos, openDbReadOnly } from "@hub/db";
import { loadProject } from "@hub/projects";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { mailAppDraftWriter } from "./mail-drafts";
import { createHubMcpServer } from "./mcp";

/**
 * `hub mcp`: the hub's MCP server on stdio (P51, P52). Env: `HUB_HOME`, `HUB_PROJECT` (every tool refuses without it),
 * `HUB_DB` optional. The database is opened read-only (a `draft_write` bumps only the live counter, P53); the one Mail write is `draft_write` (an unsent draft, through Mail's
 * scripting from this process, outside the agent's sandbox). Nothing but the protocol may reach stdout.
 */
export async function serveHubMcp(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const paths = hubPaths({ env });
  const handle = openDbReadOnly(paths.db);
  const projectMail = (slug: string) => {
    const m = loadProject(paths.projects, slug).parsed.config.mail;
    return { accounts: m.accounts, sender: m.sender };
  };
  const server = createHubMcpServer(createRepos(handle.db), { hubProject: env.HUB_PROJECT?.trim() || undefined, focusFile: paths.focus, drafts: mailAppDraftWriter(), projectMail, mailWritten: (slug) => void bumpTopicIn(paths.db, "mail", slug) });
  process.on("SIGINT", () => handle.close());
  await server.connect(new StdioServerTransport());
}
