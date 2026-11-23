import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readJson } from "../context";
import type { Step } from "../types";
import { fail, pass } from "./helpers";

const INIT = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "hub-doctor", version: "0" } } });

// P129 A4: the knowledge tools are `hub mcp`'s, so the one local MCP program a session starts is `hub mcp`.
export const mcpSteps: Step[] = [
  {
    id: "mcp.hub", group: "MCP", title: "hub mcp starts",
    why: "Sessions reach the admin's focus, the project's settings, its knowledge and the draft writer through the `hub` server (`hub mcp`), a local program that Claude Code starts from `.mcp.json`. When it cannot start, the agent loses all of them silently.",
    verifies: "The `hub` command of `.mcp.json` is started exactly as a session starts it (`node` is the hub's own Node) and answers an MCP `initialize`. It opens a throw-away empty database, read-only, so the real `data/app.db` is never opened; the process is closed at once.",
    manual: { steps: ["Run `hub install --only files.mcp-json` (writes the server with absolute paths), then `pnpm install` in the core's `app/` if the program is missing."] },
    async check(ctx) {
      const server = readJson(ctx.paths.mcpFile)?.mcpServers?.hub as { type?: string; command?: string; args?: string[]; env?: Record<string, string> } | undefined;
      if (!server || server.type !== "stdio" || !server.command) return fail("`hub` is not a stdio server in .mcp.json: `hub install --only files.mcp-json`");
      // A session starts `node` as the hub's own Node (`instanceMcpServers`), never the one on PATH.
      const cmd = server.command === "node" ? process.execPath : path.resolve(ctx.paths.home, server.command);
      if (!existsSync(cmd)) return fail(`${server.command} does not exist: \`hub install --only files.mcp-json\`, then \`pnpm install\` in app/`);
      const script = server.args?.find((a) => a.endsWith(".mjs") || a.endsWith(".ts"));
      if (script && !existsSync(path.resolve(ctx.paths.home, script))) return fail(`${script} does not exist: \`hub install --only files.mcp-json\``);
      const tmp = mkdtempSync(path.join(tmpdir(), "hub-mcp-check-"));
      try {
        const db = path.join(tmp, "check.db");
        writeFileSync(db, ""); // an empty file is an empty SQLite database; `hub mcp` opens it read-only
        const env = { ...(server.env ?? {}), HOME: ctx.home, HUB_HOME: ctx.paths.home, HUB_DB: db, HUB_PROJECT: "" };
        const r = await ctx.run(cmd, server.args ?? [], { env, input: `${INIT}\n`, timeoutMs: 45_000 });
        const reply = r.stdout.split("\n").map((l) => { try { return JSON.parse(l) as { id?: number; result?: { serverInfo?: { name?: string } } }; } catch { return undefined; } }).find((j) => j?.id === 1);
        if (reply?.result) return pass(`started and answered initialize${reply.result.serverInfo?.name ? ` (${reply.result.serverInfo.name})` : ""}`);
        return fail(r.code === 124 ? "started but did not answer initialize within 45 s" : `exited (${r.code}) without answering initialize: ${r.stderr.trim().split("\n").at(-1)?.slice(0, 160) ?? "no output"}`);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  },
];
