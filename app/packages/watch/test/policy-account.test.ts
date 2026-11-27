import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { policyGeneration, readWatchPolicy, watchPolicyFile, type WatchPolicy } from "../src/policy";
import { accountJournal } from "../src/reader/account-state";
import { createWatchQueue } from "../src/reader/queue";
import { FloodWaitError } from "../src/reader/types";

const T0 = Date.parse("2026-11-27T10:00:00Z");
const policy = (): WatchPolicy => ({ version: 1, revision: 1, enabled: true, account: "12345", approval: { requestRef: "owner-request-20261127", approvedAt: new Date(T0).toISOString() },
  directions: { tools: { groups: ["garden_talk"], join: true, reply: false } }, limits: { joinsPerDay: 3, repliesPerDay: 0 } });
const temp = () => mkdtempSync(join(tmpdir(), "watch-authority-"));

describe("the protected Watch grant", () => {
  it("ignores a project-adjacent policy and fails closed for an invalid protected grant", () => {
    const project = temp();
    const file = watchPolicyFile(join(project, "state", "projects"), "acme");
    writeFileSync(join(project, "watch-policy.json"), JSON.stringify(policy()));
    expect(readWatchPolicy(project, file)).toEqual({ state: "none" });
    mkdirSync(join(project, "state", "projects", "acme"), { recursive: true });
    writeFileSync(file, JSON.stringify({ ...policy(), account: "default" }));
    expect(readWatchPolicy(project, file).state).toBe("invalid");
    writeFileSync(file, JSON.stringify(policy()));
    expect(readWatchPolicy(project, file)).toMatchObject({ state: "ok", generation: policyGeneration(policy()) });
  });

  it("pins a reply strategy and can disable a grant even after the strategy changed", () => {
    const project = temp();
    const file = join(project, "grant.json");
    const text = "Answer the question using the supplied product facts.";
    writeFileSync(join(project, "strategy.md"), text);
    const p = policy();
    p.directions.tools = { groups: ["garden_talk"], join: true, reply: true, strategy: { path: "strategy.md", sha256: createHash("sha256").update(text).digest("hex") } };
    writeFileSync(file, JSON.stringify(p));
    expect(readWatchPolicy(project, file).state).toBe("ok");
    writeFileSync(join(project, "strategy.md"), `${text}\nChanged`);
    expect(readWatchPolicy(project, file).state).toBe("invalid");
    writeFileSync(file, JSON.stringify({ ...p, enabled: false, revision: 2 }));
    expect(readWatchPolicy(project, file).state).toBe("ok");
  });
});

describe("durable account budgets", () => {
  it("counts a failed or unknown external attempt before invoking its adapter", async () => {
    const file = join(temp(), "accounts.json");
    const journal = accountJournal(file);
    const queue = createWatchQueue({ owner: { busy: () => false }, clock: { now: () => T0, sleep: async () => {}, random: () => 0 }, account: { id: "12345", journal, joinsPerDay: () => 3 } });
    await expect(queue.run("join", async () => {
      expect(accountJournal(file).read("12345", T0)).toMatchObject({ ok: true, usage: { joins: 1 } });
      throw new Error("response lost");
    })).rejects.toThrow("response lost");
    queue.resetRun();
    expect(queue.joinStatus().used).toBe(1);
  });

  it("reserves before a call, shares quota across restarts, and never resets on a backwards clock", () => {
    const file = join(temp(), "accounts.json");
    const first = accountJournal(file);
    first.reserve("12345", 3, T0, 180_000);
    expect(() => first.reserve("12345", 3, T0 + 1, 180_000)).toThrow();
    first.reserve("12345", 3, T0 + 200_000, 180_000);
    const second = accountJournal(file);
    second.reserve("12345", 3, T0 + 400_000, 180_000);
    expect(() => second.reserve("12345", 3, T0 + 600_000, 180_000)).toThrow(/budget/);
    expect(second.read("12345", T0 - 86_400_000)).toMatchObject({ ok: true, usage: { joins: 3, day: "2026-11-27" } });
    second.reserve("12345", 3, T0 + 86_400_000, 180_000);
    expect(first.read("12345", T0)).toMatchObject({ ok: true, usage: { joins: 1, day: "2026-11-28" } });
  });

  it("does not remove a stale or unknown lock and does not replace corrupt quota with zero", () => {
    const file = join(temp(), "accounts.json");
    const journal = accountJournal(file);
    journal.reserve("12345", 3, T0, 180_000);
    const before = readFileSync(file, "utf8");
    const stale = JSON.stringify({ pid: 2147483647, token: "previous-owner" });
    writeFileSync(`${file}.lock`, stale);
    expect(() => journal.reserve("12345", 3, T0 + 200_000, 180_000)).toThrow();
    expect(readFileSync(`${file}.lock`, "utf8")).toBe(stale);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(journal.read("12345", T0)).toMatchObject({ ok: false });
    const corruptFile = join(temp(), "accounts.json");
    writeFileSync(corruptFile, "{ broken");
    const corrupt = accountJournal(corruptFile);
    expect(corrupt.read("12345", T0)).toMatchObject({ ok: false });
    expect(() => corrupt.reserve("12345", 3, T0, 180_000)).toThrow();
    expect(readFileSync(corruptFile, "utf8")).toBe("{ broken");
    expect(existsSync(`${corruptFile}.lock`)).toBe(false);
  });

  it("retains FLOOD_WAIT across restart and rechecks it after waiting for the owner's account", async () => {
    const file = join(temp(), "accounts.json");
    const journal = accountJournal(file);
    let now = T0;
    const make = () => createWatchQueue({ owner: { busy: () => false }, clock: { now: () => now, sleep: async (ms) => { now += ms; }, random: () => 0 }, account: { id: "12345", journal, joinsPerDay: () => 3 } });
    await expect(make().run("history", () => Promise.reject(new FloodWaitError(120)))).rejects.toBeInstanceOf(FloodWaitError);
    const restarted = make();
    expect(restarted.parkedUntil()).toBe(new Date(T0 + 3_720_000).toISOString());
    now -= 60_000;
    expect(restarted.parkedUntil()).toBe(new Date(T0 + 3_720_000).toISOString());
    now = T0 + 4_000_000;
    let busy = true;
    let calls = 0;
    const concurrent = createWatchQueue({ owner: { busy: () => busy }, account: { id: "12345", journal, joinsPerDay: () => 3 },
      clock: { now: () => now, sleep: async (ms) => { now += ms; busy = false; journal.park("12345", now + 3_600_000, now); }, random: () => 0 } });
    await expect(concurrent.run("history", async () => { calls += 1; })).rejects.toThrow(/wait|parked/);
    expect(calls).toBe(0);
  });
});
