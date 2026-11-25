import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LeadPassBrain } from "@hub/config/lead-pass";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { afterSweep, leadPassSchedule, type LeadPassSettings } from "../../src/passes/schedule";
import type { Clock } from "../../src/messengers/autopilot/scheduler";

// P147 L4: the lead pass's timer on a fake clock (the Mac's local day), a fake brain, nothing spawned or sent. D8: it starts
// after the day's follow-up sweep finished, or 30 minutes past its time when no sweep started.

let dir: string;
let h: DbHandle;
let repos: Repos;
let now: number;
const clock: Clock = { now: () => now, setTimeout: () => 0, clearTimeout: () => undefined, random: () => 0.5 };
const at = (hh: number, mm: number, day = 25) => new Date(2026, 10, day, hh, mm).getTime();
const brain: LeadPassBrain = { name: "test", turn: async () => ({ kind: "decided", decision: "hand_over", costUsd: null }) };

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-lead-schedule-"));
  h = openDb(path.join(dir, "app.db"));
  repos = createRepos(h.db);
});
afterEach(() => {
  h.close();
  rmSync(dir, { recursive: true, force: true });
});

function schedule(settings: LeadPassSettings = { schedule: "daily", at: "09:30", sweepDaily: true }) {
  return leadPassSchedule({ repos, brain, clock, windowDays: () => 14, prefetch: { project: () => undefined }, projects: async () => [{ slug: "acme", settings }] });
}
const settle = () => new Promise((r) => setTimeout(r, 50));
const passes = async (day = 25) => (await repos.leadPass.passesSince("acme", new Date(at(0, 0, day)).toISOString())).map((s) => s.trigger);

describe("the lead pass timer", () => {
  it("waits for the day's follow-up sweep (D8), then runs one scheduled pass and no second that day", async () => {
    const s = schedule();
    now = at(9, 31);
    const sweep = await repos.followUps.startSweep("acme", "schedule", new Date(at(9, 0)).toISOString());
    await s.tick();
    await settle();
    expect(await passes()).toEqual([]);
    await repos.followUps.finishSweep(sweep.id, { finishedAt: new Date(at(9, 31)).toISOString() });
    now = at(9, 32);
    await s.tick();
    await settle();
    await s.tick();
    await settle();
    expect(await passes()).toEqual(["schedule"]);
    await s.stop();
  });

  it("with no sweep started it waits 30 minutes at most; a project with the pass off is never run by the timer", async () => {
    const s = schedule();
    now = at(9, 45);
    await s.tick();
    await settle();
    expect(await passes()).toEqual([]);
    now = at(10, 1);
    await s.tick();
    await settle();
    expect(await passes()).toEqual(["schedule"]);
    await s.stop();
    const off = schedule({ schedule: "off", at: "09:30", sweepDaily: false });
    now = at(11, 0, 26);
    await off.tick();
    await settle();
    expect(await passes(26)).toEqual([]);
    await off.stop();
  });

  it("a start long after the time is a catch-up; with no daily sweep it does not wait", async () => {
    now = at(15, 0);
    const s = schedule({ schedule: "daily", at: "09:30", sweepDaily: false });
    await s.tick();
    await settle();
    expect(await passes()).toEqual(["catch_up"]);
    await s.stop();
  });

  it("Run lead pass now: three a day, then refused; the button is not the day's scheduled pass", async () => {
    now = at(8, 0);
    const s = schedule();
    for (let i = 0; i < 3; i++) {
      const r = await s.runNow("acme");
      expect("pass" in r).toBe(true);
      if ("pass" in r) await r.pass;
    }
    expect(await s.runNow("acme")).toEqual({ refused: expect.stringMatching(/at most 3 times a day/) });
    expect(await s.runNowOff("acme")).toBe("used 3 of 3 today");
    expect(await s.next("acme", { schedule: "daily", at: "09:30" })).toBe(new Date(at(9, 30)).toISOString());
    await s.stop();
  });

  it("afterSweep is pure", () => {
    const due = at(9, 30);
    expect(afterSweep({ now: due, due, sweepDaily: false, sweeps: [] })).toBe(true);
    expect(afterSweep({ now: due, due, sweepDaily: true, sweeps: [{ trigger: "button", finishedAt: "x" }] })).toBe(false);
    expect(afterSweep({ now: due, due, sweepDaily: true, sweeps: [{ trigger: "catch_up", finishedAt: "x" }] })).toBe(true);
    expect(afterSweep({ now: due + 30 * 60_000, due, sweepDaily: true, sweeps: [{ trigger: "schedule", finishedAt: null }] })).toBe(true);
  });
});
