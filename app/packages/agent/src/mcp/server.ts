import type { Repos } from "@hub/db";
import { McpServer } from "@modelcontextprotocol/server";
import { MESSENGER_TOOLS, registerMessengerTools } from "../messenger/tools";
import { MESSENGER_SEND_TOOL, registerMessengerSend } from "../messenger/send-tool";
import { toolCtx, type HubMcpEnv } from "./ports";
import { registerDraftShow } from "./tools/draft-show";
import { registerDraftWrite } from "./tools/draft-write";
import { registerFocusTools } from "./tools/focus";
import { registerMailReadTools } from "./tools/mail-read";
import { registerProjectTools } from "./tools/project";

// `hub mcp` (P51, decision 0029): the hub's own stdio MCP server, bound to `HUB_PROJECT`. The database is opened read-only
// by the caller (`openDbReadOnly`), so a write of a row is impossible, not just absent; the exceptions are short write
// connections that hold no row the owner reads as his (the live counter, the Mail version and write records, a revision
// recorded in place, a messenger draft). One Mail write (P52, decision 0030): `draft_write`, an unsent draft. No send but
// decision 0046's `messenger_send`, in an attended instance only. The tool names stay clear of `SEND_LIKE_TOOL`; a test pins the list.

export const HUB_MCP_TOOLS = ["focus", "highlight", "draft_show", "client_show", "inbound_show", "drafts_list", "mail_brand", "project_notion", "project_links", "draft_write", ...MESSENGER_TOOLS] as const;
/** Decision 0046: the tools an attended session gets besides {@link HUB_MCP_TOOLS}: the one send on the owner's word. Never unattended. */
export const HUB_MCP_ATTENDED_TOOLS = [MESSENGER_SEND_TOOL] as const;

export function createHubMcpServer(repos: Repos, env: HubMcpEnv): McpServer {
  const server = new McpServer({ name: "hub", version: "0.1.0" });
  const ctx = toolCtx(repos, env);
  registerFocusTools(server, ctx);
  registerDraftShow(server, ctx);
  registerMailReadTools(server, ctx);
  registerProjectTools(server, ctx);
  registerDraftWrite(server, ctx);
  registerMessengerTools(server, repos, {
    project: ctx.project,
    ...(env.withRepos ? { withRepos: env.withRepos } : {}),
    ...(env.now ? { now: env.now } : {}),
    policy: () => env.projectMail?.(ctx.project()).messengers ?? { language: null, instruction: null },
  });
  // Decision 0046: the one send of an attended session, on the owner's word; `hub mcp` passes the port only when not unattended.
  if (env.agentSend) registerMessengerSend(server, { project: ctx.project, send: env.agentSend });
  return server;
}
