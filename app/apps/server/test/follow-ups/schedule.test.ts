import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FollowUpBrain } from "@hub/config/follow-ups";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { followUpSchedule, nextRun, type FollowUpSettings } from "../../src/follow-ups/schedule";
import type { Clock } from "../../src/messengers/autopilot/scheduler";

// P142 F4: the sweep's timer on a fake clock (the Mac's local day), a fake brain, nothing spawned or sent.

let dir: string;
let h: DbHandle;
let repos: Repos;
let now: number;
const clock: Clock = { now: () => now, setTimeout: () => 0, clearTimeout: () => undefined, random: () => 0.5 };
const at = (hh: number, mm: number, day = 25) => new Date(2026, 10, day, hh, mm).getTime();
const brain: FollowUpBrain = { turn: async () => ({ kind: "decided", decision: "wait" }) };

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-schedule-"));
  h = openDb(path.join(dir, "app.db"));
  repos = createRepos(h.db);
});
afterEach(() => {
  h.close();
  rmSync(dir, { recursive: true, force: true });
});

function schedule(settings: FollowUpSettings = { schedule: "daily", at: "09:00" }) {
  return followUpSchedule({ repos, brain, clock, prefetch: { project: () => undefined }, projects: async () => [{ slug: "acme", settings }] });
}
const settle = () => new Promise((r) => setTimeout(r, 50));
const sweeps = async () => (await repos.followUps.sweepsSince("acme", new Date(at(0, 0)).toISOString())).map((s) => s.trigger);

describe("the follow-up timer", () => {
  it("runs nothing before the time, one scheduled sweep after it, and no second one that day", async () => {
    const s = schedule();
    now = at(8, 59);
    await s.tick();
    await settle();
    expect(await sweeps()).toEqual([]);
    now = at(9, 5);
    await s.tick();
    await settle();
    await s.tick();
    await settle();
    expect(await sweeps()).toEqual(["schedule"]);
    expect(await s.sweptToday("acme")).toBe(true);
    await s.stop();
  });

  it("a start long after the time is a catch-up; a project with the schedule off is never swept by the timer", async () => {
    now = at(14, 0);
    const s = schedule();
    await s.tick();
    await settle();
    expect(await sweeps()).toEqual(["catch_up"]);
    await s.stop();
    const off = schedule({ schedule: "off", at: "09:00" });
    now = at(9, 1, 26);
    await off.tick();
    await settle();
    expect((await repos.followUps.sweepsSince("acme", new Date(at(0, 0, 26)).toISOString())).length).toBe(0);
    await off.stop();
  });

  it("Run follow-ups now: three a day, then refused with its reason; the button does not count as the day's sweep", async () => {
    now = at(8, 0);
    const s = schedule();
    for (let i = 0; i < 3; i++) {
      const r = await s.runNow("acme");
      expect("sweep" in r).toBe(true);
      if ("sweep" in r) await r.sweep;
    }
    expect(await s.runNow("acme")).toEqual({ refused: expect.stringMatching(/at most 3 times a day/) });
    expect(await s.runNowOff("acme")).toBe("used 3 of 3 today");
    expect(await s.sweptToday("acme")).toBe(false);
    await s.stop();
  });

  it("nextRun: today when the time is still ahead, tomorrow once swept or passed", () => {
    expect(nextRun(new Date(at(8, 0)), "09:00", false).getTime()).toBe(at(9, 0));
    expect(nextRun(new Date(at(8, 0)), "09:00", true).getTime()).toBe(at(9, 0, 26));
    expect(nextRun(new Date(at(10, 0)), "09:00", false).getTime()).toBe(at(9, 0, 26));
  });
});
