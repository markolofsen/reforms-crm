import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readJson } from "../context.ts";
import type { Step } from "../types.ts";
import { fail, pass } from "./helpers.ts";

const INIT = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "hub-doctor", version: "0" } } });

export const mcpSteps: Step[] = [
  {
    id: "mcp.knowledge", group: "MCP", title: "knowledge-mcp starts",
    why: "Sessions search the project's knowledge through the `knowledge-mcp` server, a local program that Claude Code starts from `.mcp.json`. When it cannot start, the agent loses the knowledge base silently.",
    verifies: "The `knowledge-mcp` command of `.mcp.json` is started exactly as Claude would start it and answers an MCP `initialize`. It runs against a throw-away empty database, so the real `data/app.db` is never opened; the process is closed at once.",
    manual: { steps: ["Run `hub install --only files.mcp-json` (writes the server with absolute paths), then `pnpm install` in the core's `app/` if the program is missing."] },
    async check(ctx) {
      const server = readJson(ctx.paths.mcpFile)?.mcpServers?.["knowledge-mcp"] as { type?: string; command?: string; args?: string[]; env?: Record<string, string> } | undefined;
      if (!server || server.type !== "stdio" || !server.command) return fail("`knowledge-mcp` is not a stdio server in .mcp.json: `hub install --only files.mcp-json`");
      const cmd = path.resolve(ctx.paths.home, server.command);
      if (!existsSync(cmd)) return fail(`${server.command} does not exist: \`hub install --only files.mcp-json\`, then \`pnpm install\` in app/`);
      const tmp = mkdtempSync(path.join(tmpdir(), "hub-knowledge-check-"));
      try {
        const env = { ...(server.env ?? {}), HOME: ctx.home, HUB_HOME: ctx.paths.home, HUB_DB: path.join(tmp, "check.db"), HUB_PROJECT: "" };
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
