import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FollowUpBrain, FollowUpTurn } from "@hub/config/follow-ups";
import { createRepos, openDb, type DbHandle, type DueClient, type Repos } from "@hub/db";
import { runSweep, type SweepDeps } from "../../src/follow-ups/sweep";

// P142 F4: one sweep's budgets and stops, on a fake brain (nothing spawns, nothing is sent).

let dir: string;
let h: DbHandle;
let repos: Repos;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-sweep-"));
  h = openDb(path.join(dir, "app.db"));
  repos = createRepos(h.db);
});
afterEach(() => {
  h.close();
  rmSync(dir, { recursive: true, force: true });
});

const due = (n: number): DueClient[] => Array.from({ length: n }, (_, i) => ({ clientId: i + 1, name: `C${i + 1}`, email: `c${i + 1}@example.test`, ourLastAt: `2026-11-1${i}T09:00:00.000Z`, theirLastAt: null, lastChannel: "mail", chats: [], onRequest: false, plan: null }));

function deps(clients: DueClient[], brain: FollowUpBrain, limits: SweepDeps["limits"] = {}): SweepDeps & { seen: FollowUpTurn[] } {
  const seen: FollowUpTurn[] = [];
  const r: Repos = { ...repos, followUps: { ...repos.followUps, due: async () => ({ clients, unlinkedWroteLast: 0 }) } } as Repos;
  return { repos: r, brain: { turn: async (t, s) => (seen.push(t), brain.turn(t, s)) }, prefetch: { project: () => undefined }, limits: { slotPollMs: 1, ...limits }, seen };
}

describe("runSweep", () => {
  it("one turn per listed client, counted by decision, and one finished row", async () => {
    const d = deps(due(3), { turn: async (t) => ({ kind: "decided", decision: t.client === 2 ? "stop" : "wait" }) });
    const row = await runSweep(d, "acme", "button");
    expect(d.seen.map((t) => t.client)).toEqual([1, 2, 3]);
    expect(row).toMatchObject({ listed: 3, turns: 3, waited: 2, stopped: 1, failed: 0, skipped: 0, error: null, trigger: "button" });
    expect(row?.finishedAt).toEqual(expect.any(String));
  });

  it("stops at the sweep's budget and rolls the rest; the Mac's daily budget counts earlier sweeps", async () => {
    const wait: FollowUpBrain = { turn: async () => ({ kind: "decided", decision: "wait" }) };
    expect(await runSweep(deps(due(4), wait, { sweepTurns: 2 }), "acme", "schedule")).toMatchObject({ turns: 2, skipped: 2, error: null });
    // 2 turns used today: a daily budget of 3 leaves room for 1.
    expect(await runSweep(deps(due(4), wait, { instanceTurns: 3 }), "acme", "schedule")).toMatchObject({ turns: 1, skipped: 3 });
    expect(await runSweep(deps(due(2), wait, { instanceTurns: 3 }), "acme", "schedule")).toMatchObject({ turns: 0, error: expect.stringMatching(/used up/) });
  });

  it("three failed turns in a row stop the sweep with the reason; an undecided turn is skipped", async () => {
    const failing = deps(due(5), { turn: async () => { throw new Error("claude exited 1"); } });
    expect(await runSweep(failing, "acme", "schedule")).toMatchObject({ turns: 3, failed: 3, skipped: 2, error: expect.stringMatching(/3 turns failed in a row: claude exited 1/) });
    expect(await runSweep(deps(due(1), { turn: async () => ({ kind: "undecided" }) }), "acme", "schedule")).toMatchObject({ turns: 1, skipped: 1, error: null });
  });
});
