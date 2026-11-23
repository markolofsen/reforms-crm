import { existsSync } from "node:fs";
import path from "node:path";
import type { HubPaths } from "@hub/config/paths";
import { which, type Ctx } from "./context";

type Server = Record<string, unknown>;

/**
 * Servers the core no longer ships (P129 A4: `knowledge-mcp`, whose tools are `hub mcp`'s now). `files.mcp-json` drops them from
 * an instance's `.mcp.json` and ignores them in an older `config/mcp.json`, so the owner's Claude never starts a removed program.
 */
export const RETIRED_MCP_SERVERS: readonly string[] = ["knowledge-mcp"];

/**
 * A stdio server of the core's `config/mcp.json` names its program by a path relative to the core (`app/packages/...`). An instance starts
 * claude in its own folder, where that path does not exist: so the server is written with absolute paths under the core, and told where
 * the instance is. HTTP servers are returned unchanged.
 */
export function instanceServer(server: Server, paths: HubPaths): Server {
  const s = structuredClone(server);
  if (s.type !== "stdio") return s;
  const abs = (v: unknown) => (typeof v === "string" && v.startsWith("app/") ? path.join(paths.core, v) : v);
  s.command = abs(s.command);
  if (Array.isArray(s.args)) s.args = s.args.map(abs);
  s.env = { ...(s.env as object), HUB_HOME: paths.home };
  return s;
}

/**
 * Stdio servers of an instance's `.mcp.json` whose command does not resolve to an existing file. A command with a slash is a path (relative:
 * to the instance, where claude starts); a bare name is looked up on PATH. Returns one line per broken server.
 */
export function brokenStdioCommands(servers: Record<string, Server>, ctx: Ctx): string[] {
  const out: string[] = [];
  for (const [name, s] of Object.entries(servers)) {
    if (s.type !== "stdio" || typeof s.command !== "string") continue;
    const cmd = s.command;
    const found = cmd.includes("/") ? existsSync(path.resolve(ctx.paths.home, cmd)) : which(ctx, cmd) !== undefined;
    if (!found) out.push(`${name}: command ${cmd} does not exist${cmd.includes("/") && !path.isAbsolute(cmd) ? ` (a relative path is read from ${ctx.paths.home}, not from the core)` : ""}`);
  }
  return out;
}
