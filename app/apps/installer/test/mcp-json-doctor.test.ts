import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileSteps } from "../src/steps/files";
import { instanceServer } from "../src/mcp-servers";
import { fake } from "./helpers";

// S5 trap: an instance root `.mcp.json` that names the core's stdio program by a relative `app/...` path. Claude starts in the instance
// folder, where that path does not exist, so the server silently never starts. `files.mcp-json` must catch it and write it absolute.
// (The trap's server was `knowledge-mcp` until P129 A4 retired it; any core stdio program behaves the same.)
const step = fileSteps.find((s) => s.id === "files.mcp-json")!;
const CORE_STDIO = { type: "stdio", command: "app/apps/installer/node_modules/.bin/tsx", args: ["app/apps/installer/src/cli.ts"], env: { HUB_PROJECT: "${HUB_PROJECT:-}" } };
const put = (f: string, v: unknown) => { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v)); };

describe("files.mcp-json: stdio commands of the instance .mcp.json exist", () => {
  it("fails on a relative core path, names the server and the fix", async () => {
    const f = fake();
    put(path.join(f.root, "config", "mcp.json"), { mcpServers: { "core-stdio": CORE_STDIO } });
    put(f.ctx.paths.mcpFile, { mcpServers: { "core-stdio": CORE_STDIO } });
    const r = await step.check(f.ctx);
    expect(r.level).toBe("fail");
    expect(r.detail).toContain("core-stdio: command app/apps/installer/node_modules/.bin/tsx does not exist");
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
    put(path.join(f.root, "config", "mcp.json"), { mcpServers: { "mail-mcp": { type: "http", url: "http://localhost:8787" }, "core-stdio": CORE_STDIO } });
    put(f.ctx.paths.mcpFile, { mcpServers: { "core-stdio": CORE_STDIO } }); // the stale file the trap leaves behind
    await step.apply!(f.ctx);
    const k = JSON.parse(readFileSync(f.ctx.paths.mcpFile, "utf8")).mcpServers["core-stdio"];
    expect(k.command).toBe(path.join(f.ctx.paths.core, CORE_STDIO.command));
    expect(k.args).toEqual([path.join(f.ctx.paths.core, CORE_STDIO.args[0]!)]);
    expect(k.env.HUB_HOME).toBe(f.root);
    const r = await step.check!(f.ctx);
    expect(r.level, r.detail).toBe("pass");
  });
  it("drops a server the core no longer ships (knowledge-mcp, P129 A4) and keeps the owner's own", async () => {
    const f = fake();
    const old = { type: "stdio", command: "/bin/sh", args: ["app/packages/knowledge/src/mcp-bin.ts"] };
    put(path.join(f.root, "config", "mcp.json"), { mcpServers: { "mail-mcp": { type: "http", url: "http://localhost:8787" }, "knowledge-mcp": old } });
    put(f.ctx.paths.mcpFile, { mcpServers: { "knowledge-mcp": old, mine: { type: "http", url: "http://mine" } } });
    const r = await step.check(f.ctx);
    expect(r.level).toBe("fail");
    expect(r.detail).toContain("knowledge-mcp");
    await step.apply!(f.ctx);
    const servers = JSON.parse(readFileSync(f.ctx.paths.mcpFile, "utf8")).mcpServers;
    expect(Object.keys(servers).sort()).toEqual(["hub", "mail-mcp", "mine"]);
    expect((await step.check(f.ctx)).level).toBe("pass");
  });
  it("writes the core's hub server when config/mcp.json predates it, on the hub's own Node, so the mcp.hub check finds it", async () => {
    const f = fake();
    put(path.join(f.root, "config", "mcp.json"), { mcpServers: { "mail-mcp": { type: "http", url: "http://localhost:8787" } } });
    put(f.ctx.paths.mcpFile, { mcpServers: { "mail-mcp": { type: "http", url: "http://localhost:8787" } } });
    const before = await step.check(f.ctx);
    expect(before.level).toBe("fail");
    expect(before.detail).toContain("hub");
    await step.apply!(f.ctx);
    const hub = JSON.parse(readFileSync(f.ctx.paths.mcpFile, "utf8")).mcpServers.hub;
    expect(hub.type).toBe("stdio");
    expect(hub.command).toBe(process.execPath);
    expect(hub.args).toEqual([path.join(f.ctx.paths.core, "app/apps/installer/bin/hub.mjs"), "mcp"]);
    expect(hub.env.HUB_HOME).toBe(f.root);
    expect((await step.check(f.ctx)).level).toBe("pass");
  });
  it("an http server is returned unchanged", () => {
    const f = fake();
    const http = { type: "http", url: "http://x" };
    expect(instanceServer(http, f.ctx.paths)).toEqual(http);
  });
});
