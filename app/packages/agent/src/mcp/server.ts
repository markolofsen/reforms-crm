import type { Repos } from "@hub/db";
import { McpServer } from "@modelcontextprotocol/server";
import { registerTools } from "./define";
import { toolCtx, type HubMcpEnv } from "./ports";
import { ATTENDED_TOOLS, AUTOPILOT_TOOLS, FOLLOW_UP_TOOLS, LEAD_PASS_TOOLS, MAIL_PASS_TOOLS, TOOLS } from "./tools";

// `hub mcp` (P51, decision 0029): the hub's own stdio MCP server, bound to `HUB_PROJECT`. The database is opened read-only
// by the caller (`openDbReadOnly`), so a write of a row is impossible, not just absent; the exceptions are short write
// connections that hold no row the owner reads as his (the live counter, the Mail version and write records, a revision
// recorded in place, a messenger draft). One Mail write (P52, decision 0030): `draft_write`, an unsent draft. No send but
// decision 0046's `messenger_send`, in a session the owner started only. The tool names stay clear of `SEND_LIKE_TOOL`; a test pins the list.

export const HUB_MCP_TOOLS: readonly string[] = TOOLS.map((t) => t.name);
/** Decision 0046: the tools an attended session gets besides {@link HUB_MCP_TOOLS}: the one send on the owner's word. Never unattended. */
export const HUB_MCP_ATTENDED_TOOLS: readonly string[] = ATTENDED_TOOLS.map((t) => t.name);
/** The hub tools of an owner's session that write (a draft, a record, the pointer, the one send): Codex approves them by name, no prompt. */
export const HUB_MCP_WRITE_TOOLS: readonly string[] = [...TOOLS, ...ATTENDED_TOOLS].filter((t) => t.effect !== "read").map((t) => t.name);

export function createHubMcpServer(repos: Repos, env: HubMcpEnv): McpServer {
  const server = new McpServer({ name: "hub", version: "0.1.0" });
  const ctx = toolCtx(repos, env);
  // Decision 0048 (P139 A3): an autopilot turn's server has its five bound tools and nothing else, attended instance or not.
  if (env.autopilotChat !== undefined) {
    registerTools(server, AUTOPILOT_TOOLS, ctx);
    return server;
  }
  // Decision 0050 (P142): a sweep turn's server has its eight client-bound tools and nothing else.
  if (env.followUpClient !== undefined) {
    registerTools(server, FOLLOW_UP_TOOLS, ctx);
    return server;
  }
  // Decision 0055 (P147): a lead pass turn's server has its six lead-bound tools and nothing else.
  if (env.leadPage !== undefined) {
    registerTools(server, LEAD_PASS_TOOLS, ctx);
    return server;
  }
  // Decision 0055 point 9 (P147 3h): a mail pass turn's server has its eight message-bound tools and nothing else.
  if (env.mailInbound !== undefined) {
    registerTools(server, MAIL_PASS_TOOLS, ctx);
    return server;
  }
  registerTools(server, TOOLS, ctx);
  // Decision 0046: the one send of an attended session, on the owner's word; `hub mcp` passes the port only outside a background run.
  if (env.agentSend) registerTools(server, ATTENDED_TOOLS, ctx);
  return server;
}
