import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hubPaths } from "@hub/config/paths";
import { agentToolsDto } from "@hub/contract/agent-tools";
import type { Repos } from "@hub/db";
import { createAgentTools } from "../../src/agent/tools";
import { testApp } from "../support/runtime";

// Connections' Agent tools (P49 5B) on the fake rows: nothing is probed.

const repos = { projects: { get: async (s: string) => (s === "acme" ? { slug: "acme" } : null) } } as unknown as Repos;
const H = { "content-type": "application/json" };

function setup() {
  const home = mkdtempSync(join(tmpdir(), "hub-server-agent-tools-"));
  mkdirSync(join(home, "config"), { recursive: true });
  writeFileSync(join(home, "config", "config.json"), JSON.stringify({ agent: { default: "codex", unattended: true } }) /* a retired key, read by nothing */);
  let t = Date.parse("2026-11-18T10:00:00Z");
  const agentTools = createAgentTools({ paths: hubPaths({ home, env: {} }), repos, fake: true, now: () => new Date((t += 1000)) });
  const app = testApp(repos, { agentTools });
  return (method: string, p: string) => app.request(`http://127.0.0.1:4317${p}`, { method, headers: H });
}

describe("agent tools", () => {
  it("the first GET computes the rows of both CLIs, the next returns them, Refresh recomputes", async () => {
    const call = setup();
    const a = agentToolsDto.parse(await (await call("GET", "/api/projects/acme/agent-tools")).json());
    expect(a).toMatchObject({ project: "acme", defaultCli: "codex" });
    expect(a).not.toHaveProperty("unattended");
    expect(new Set(a.rows.map((r) => r.cli))).toEqual(new Set(["claude", "codex"]));
    expect(a.rows.filter((r) => r.state === "fail").map((r) => r.fix)).toEqual(["hub agent acme --prepare", "hub agent acme --cli codex --prepare"]);
    expect(a.rows.some((r) => r.state === "warn")).toBe(true);
    const b = agentToolsDto.parse(await (await call("GET", "/api/projects/acme/agent-tools")).json());
    expect(b.checkedAt).toBe(a.checkedAt);
    const c = agentToolsDto.parse(await (await call("POST", "/api/projects/acme/agent-tools/refresh")).json());
    expect(c.checkedAt).not.toBe(a.checkedAt);
  });
  it("an unknown project is 404; without the service both routes are 404", async () => {
    expect((await setup()("GET", "/api/projects/nobody/agent-tools")).status).toBe(404);
    const bare = testApp(repos, {});
    expect((await bare.request("http://127.0.0.1:4317/api/projects/acme/agent-tools", { headers: H })).status).toBe(404);
  });
});
