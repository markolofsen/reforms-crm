import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileSteps } from "../src/steps/files";
import { instanceServer } from "../src/mcp-servers";
import { fake } from "./helpers";

// S5 trap: an instance root `.mcp.json` that names the core's stdio program by a relative `app/...` path. Claude starts in the instance
// folder, where that path does not exist, so the knowledge server silently never starts. `files.mcp-json` must catch it and write it absolute.
const step = fileSteps.find((s) => s.id === "files.mcp-json")!;
const KNOWLEDGE = { type: "stdio", command: "app/packages/knowledge/node_modules/.bin/tsx", args: ["app/packages/knowledge/src/mcp-bin.ts"], env: { HUB_PROJECT: "${HUB_PROJECT:-}" } };
const put = (f: string, v: unknown) => { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v)); };

describe("files.mcp-json: stdio commands of the instance .mcp.json exist", () => {
  it("fails on a relative core path, names the server and the fix", async () => {
    const f = fake();
    put(path.join(f.root, "config", "mcp.json"), { mcpServers: { "knowledge-mcp": KNOWLEDGE } });
    put(f.ctx.paths.mcpFile, { mcpServers: { "knowledge-mcp": KNOWLEDGE } });
    const r = await step.check(f.ctx);
    expect(r.level).toBe("fail");
    expect(r.detail).toContain("knowledge-mcp: command app/packages/knowledge/node_modules/.bin/tsx does not exist");
    expect(r.detail).toContain("hub install --only files.mcp-json");
  });
  it("fails on an absolute path that is not there", async () => {
    const f = fake();
    put(path.join(f.root, "config", "mcp.json"), { mcpServers: {} });
    put(f.ctx.paths.mcpFile, { mcpServers: { x: { type: "stdio", command: "/no/such/place/tsx" } } });
    expect((await step.check(f.ctx)).detail).toContain("x: command /no/such/place/tsx does not exist");
  });
  it("apply writes the stdio paths absolute under the core, and the check then passes", async () => {
    const f = fake();
    put(path.join(f.root, "config", "mcp.json"), { mcpServers: { "mail-mcp": { type: "http", url: "http://localhost:8787" }, "knowledge-mcp": KNOWLEDGE } });
    put(f.ctx.paths.mcpFile, { mcpServers: { "knowledge-mcp": KNOWLEDGE } }); // the stale file the trap leaves behind
    await step.apply!(f.ctx);
    const k = JSON.parse(readFileSync(f.ctx.paths.mcpFile, "utf8")).mcpServers["knowledge-mcp"];
    expect(k.command).toBe(path.join(f.ctx.paths.core, KNOWLEDGE.command));
    expect(k.args).toEqual([path.join(f.ctx.paths.core, KNOWLEDGE.args[0]!)]);
    expect(k.env.HUB_HOME).toBe(f.root);
    const r = await step.check!(f.ctx);
    expect(r.level, r.detail).toBe("pass");
  });
  it("an http server is returned unchanged", () => {
    const f = fake();
    const http = { type: "http", url: "http://x" };
    expect(instanceServer(http, f.ctx.paths)).toEqual(http);
  });
});
