import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeLeadPassBrain, httpLeadPass } from "@hub/agent/lead-pass";
import { connect } from "@hub/agent/testing";
import type { LeadPassBrain } from "@hub/config/lead-pass";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { projectStore } from "@hub/projects/store";
import { leadPassRoutes } from "../../src/passes/routes";
import { leadPassSchedule } from "../../src/passes/schedule";

// The attended MCP tool, its HTTP port, route, scheduler and real ledger, on an injected brain. No model or Mail service.
let dir: string;
let handle: DbHandle;
let repos: Repos;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "hub-agent-pass-"));
  handle = openDb(join(dir, "app.db"));
  repos = createRepos(handle.db);
  await repos.clients.create({ project: "acme", email: "owner@acme.test", name: "Owner" });
});
afterEach(() => { handle.close(); rmSync(dir, { recursive: true, force: true }); });

async function seed(n = 1) {
  const now = new Date();
  await repos.leadRows.sync(Array.from({ length: n }, (_, i) => ({ project: "acme", pageId: String(i + 1).repeat(32), name: `Prospect ${i}`, email: `hello@prospect${i}.test`, accountEmail: null, brand: null, receivedAt: new Date(now.getTime() - 3_600_000).toISOString(), preview: "API access please", notionStatus: "New", hasClient: false })), now);
}

async function session(brain: LeadPassBrain) {
  const schedule = leadPassSchedule({ repos, brain, windowDays: () => 14, prefetch: { project: () => undefined }, projects: async () => [] });
  const app = leadPassRoutes({ repos, root: dir, projects: projectStore({ projects: dir }), now: () => new Date(), agentToken: "fixture-token", leadPass: { brain, schedule, stop: () => schedule.stop() } });
  const port = httpLeadPass({ port: () => 4499, token: () => "fixture-token", fetch: (input, init) => Promise.resolve(app.request(String(input), init)) });
  const mcp = await connect({ repos, env: { hubProject: "acme", focusFile: join(dir, "focus.json"), leadPassRun: port } });
  return { ...mcp, schedule };
}

describe("attended lead pass completion", () => {
  it("reports running, follows without another start, then returns recorded drafts and an empty rerun", async () => {
    await seed();
    let finish = () => {};
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const fake = fakeLeadPassBrain({ repos });
    const s = await session({ name: "delayed fake", turn: async (t, signal) => { await gate; return fake.turn(t, signal); } });
    try {
      expect((await s.call("lead_pass_start")).json).toMatchObject({ state: "running", started: true, listed: null });
      expect((await s.call("lead_pass_start", { check_only: true })).json).toMatchObject({ state: "running", started: false });
      finish();
      await s.schedule.stop();
      const result = (await s.call("lead_pass_start", { check_only: true })).json;
      expect(result).toMatchObject({ state: "finished", started: false, listed: 1, drafted: 1, failed: 0 });
      expect(result.next).toContain("1 eligible, 1 drafts, 0 failed");
      expect(await repos.leadPass.passesSince("acme", "2000")).toHaveLength(1);
      const empty = (await s.call("lead_pass_start")).json;
      expect(empty).toMatchObject({ state: "finished", listed: 0, drafted: 0 });
      expect(empty.next).toContain("nothing new to process");
    } finally { finish(); await s.schedule.stop(); await s.client.close(); }
  });

  it("does not report a stopped run as a successful finish, including the subsequent status read", async () => {
    await seed(3);
    const s = await session({ name: "failed fake", turn: async () => ({ kind: "failed", code: "failed", detail: "Fixture transport unavailable" }) });
    try {
      const started = (await s.call("lead_pass_start")).json;
      await s.schedule.stop();
      const final = (await s.call("lead_pass_start", { check_only: true })).json;
      expect(final).toMatchObject({ state: "failed", listed: 3, drafted: 0, failed: 3, started: false });
      expect(final.next).toContain("do not promise drafts");
      expect(started.state).not.toBe("finished");
      expect(await repos.leadPass.passesSince("acme", "2000")).toHaveLength(1);
    } finally { await s.schedule.stop(); await s.client.close(); }
  });
});
