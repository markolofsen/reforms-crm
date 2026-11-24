import { existsSync, readFileSync } from "node:fs";
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
 * The servers an instance's root `.mcp.json` must hold: those of its `config/mcp.json` (retired ones dropped) plus the core's own `hub`
 * server, taken from the core's defaults when the instance file predates it. Each is made absolute for the instance; `hub`'s `node` is
 * the hub's own Node, as a session's `instanceMcpServers` writes it, so plain `claude` in the instance folder starts the same program.
 */
export function rootMcpServers(cfg: Record<string, Server>, paths: HubPaths, nodeBin: string = process.execPath): Record<string, Server> {
  const out: Record<string, Server> = {};
  const hub = cfg.hub ?? readCoreServers(paths).hub;
  for (const [k, v] of Object.entries(hub ? { ...cfg, hub } : cfg)) {
    if (RETIRED_MCP_SERVERS.includes(k)) continue;
    const s = instanceServer(v, paths);
    if (k === "hub" && s.type === "stdio" && s.command === "node") s.command = nodeBin;
    out[k] = s;
  }
  return out;
}

function readCoreServers(paths: HubPaths): Record<string, Server> {
  try { return (JSON.parse(readFileSync(paths.mcpDefaults, "utf8")) as { mcpServers?: Record<string, Server> }).mcpServers ?? {}; } catch { return {}; }
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
