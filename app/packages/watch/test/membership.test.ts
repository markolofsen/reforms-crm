import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WatchConfig } from "../src/config";
import { policyGeneration, type WatchPolicy, type WatchPolicyRead } from "../src/policy";
import { accountJournal } from "../src/reader/account-state";
import { membershipTick, ownerJoin } from "../src/reader/membership";
import { createWatchQueue } from "../src/reader/queue";
import { PeerUnknownError, type JoinResult, type PublicPeer, type PublicReader } from "../src/reader/types";
import { createWatcher } from "../src/reader/poller";
import { acmeLens, fakeLlm, tempStore } from "./support";

const T0 = Date.parse("2026-11-27T10:00:00Z");
const account = "12345";
const granted = (p: WatchPolicy): WatchPolicyRead => ({ state: "ok", policy: p, generation: policyGeneration(p) });

function setup(result: JoinResult = "joined") {
  const store = tempStore();
  let now = T0;
  const config: WatchConfig = { lens: "watch-acme", on: true, account, pollMinutes: 5, groups: ["legacy_group"],
    directions: [{ id: "tools", title: "Tools", lens: "watch-acme", on: true, groups: ["garden_talk"] }] };
  const base: WatchPolicy = { version: 1, revision: 1, enabled: true, account, approval: { requestRef: "owner-request-20261127", approvedAt: new Date(now).toISOString() },
    directions: { tools: { groups: ["garden_talk"], join: true, reply: false } }, limits: { joinsPerDay: 3, repliesPerDay: 0 } };
  let policy = granted(base);
  store.ensureGroups(["legacy_group", "garden_talk"], new Date(now));
  for (const username of ["legacy_group", "garden_talk"]) store.setGroup(username, { peerId: "-10011", title: username, accessHash: "77", access: "open", lastPolledAt: new Date(now).toISOString() });
  let peer: PublicPeer = { peerId: "-10011", title: "garden_talk", accessHash: "77", canonicalUsername: "garden_talk", kind: "group", isMember: false, hasJoinRequests: false };
  let joins = 0;
  let inspections = 0;
  let onInspect = () => {};
  const reader: PublicReader = {
    resolve: async () => peer,
    inspect: async () => { inspections += 1; onInspect(); return peer; },
    history: async () => ({ ok: true, messages: [] }),
    join: async () => { joins += 1; return result; },
  };
  const queue = createWatchQueue({ owner: { busy: () => false }, clock: { now: () => now, sleep: async (ms) => { now += ms; }, random: () => 0 },
    account: { id: account, journal: accountJournal(join(mkdtempSync(join(tmpdir(), "membership-")), "accounts.json")), joinsPerDay: () => 3 } });
  const deps = { store, queue, reader: () => reader, config: () => config, policy: () => policy, account: () => account, now: () => new Date(now) };
  return { store, queue, reader, config, base, deps, tick: () => membershipTick(deps), joins: () => joins, inspections: () => inspections,
    time: (ms: number) => { now += ms; }, policy: (p: WatchPolicy) => { policy = granted(p); }, peer: (p: Partial<PublicPeer>) => { peer = { ...peer, ...p }; }, onInspect: (fn: () => void) => { onInspect = fn; } };
}

describe("owner-granted membership work", () => {
  it("joins only the granted direction and does not turn membership into a successful history read", async () => {
    const f = setup();
    f.store.setGroup("garden_talk", { access: "join_required" });
    await f.tick();
    expect(f.joins()).toBe(1);
    expect(f.store.membership(account, "garden_talk")).toMatchObject({ state: "joined", requestRef: f.base.approval.requestRef });
    expect(f.store.membership(account, "legacy_group")).toBeNull();
    expect(f.store.group("garden_talk")).toMatchObject({ access: "unknown", lastPolledAt: null });
    await f.tick();
    expect(f.joins()).toBe(1);
    expect(f.queue.joinStatus().used).toBe(1);
    f.store.close();
  });

  it("rechecks a pending request, observes approval, and never resends that request", async () => {
    const f = setup("pending");
    await f.tick();
    expect(f.store.membership(account, "garden_talk")?.state).toBe("pending");
    f.time(30_000);
    await f.tick();
    expect(f.inspections()).toBe(1);
    f.time(3_600_000);
    f.peer({ isMember: true });
    await f.tick();
    expect(f.store.membership(account, "garden_talk")?.state).toBe("joined");
    expect(f.joins()).toBe(1);
    f.store.close();
  });

  it("keeps a guard-bot step manual and a previously joined group a no-op", async () => {
    const blocked = setup("manual_required");
    await blocked.tick();
    blocked.time(10 * 3_600_000);
    await blocked.tick();
    expect(blocked.joins()).toBe(1);
    expect(blocked.store.membership(account, "garden_talk")).toMatchObject({ state: "manual_required", nextAttemptAt: null });
    const member = setup();
    member.peer({ isMember: true });
    await member.tick();
    expect(member.joins()).toBe(0);
    expect(member.queue.joinStatus().used).toBe(0);
    blocked.store.close();
    member.store.close();
  });

  it("rechecks authority after inspection and retains a queued job while the direction is off", async () => {
    const f = setup();
    f.onInspect(() => f.policy({ ...f.base, enabled: false, revision: 2 }));
    await f.tick();
    expect(f.joins()).toBe(0);
    expect(f.store.membership(account, "garden_talk")?.state).toBe("queued");
    f.config.on = false;
    f.time(86_400_000);
    await f.tick();
    expect(f.joins()).toBe(0);
    expect(f.store.membership(account, "garden_talk")?.state).toBe("queued");
    f.store.close();
  });

  it("does not inspect removed sources or record a renamed cached peer as joined", async () => {
    const renamed = setup();
    renamed.peer({ canonicalUsername: "another_group", isMember: true });
    await renamed.tick();
    expect(renamed.joins()).toBe(0);
    expect(renamed.store.membership(account, "garden_talk")).toMatchObject({ state: "manual_required", joinedAt: null });
    const removed = setup("pending");
    await removed.tick();
    removed.config.directions = [];
    removed.time(3_700_000);
    await removed.tick();
    expect(removed.inspections()).toBe(1);
    renamed.store.close();
    removed.store.close();
  });

  it("treats a legacy pending access row as an existing request, including after restart", async () => {
    const f = setup();
    f.store.setGroup("garden_talk", { access: "pending" });
    await f.tick();
    expect(f.joins()).toBe(0);
    expect(f.store.membership(account, "garden_talk")?.state).toBe("pending");
    f.store.close();
  });

  it("enforces source identity and pending state in the owner action, independently of UI visibility", async () => {
    const f = setup();
    const { llm } = fakeLlm(() => ({ content: "{}" }));
    const d = { project: "acme", config: f.config, lens: await acmeLens(), store: f.store, llm, reader: () => f.reader, queue: f.queue,
      membership: { account: () => account, policy: f.deps.policy } };
    f.peer({ canonicalUsername: "reassigned_group" });
    expect(await ownerJoin(d, f.deps.now, async () => null, "garden_talk")).toMatchObject({ ok: false });
    expect(f.joins()).toBe(0);
    f.peer({ canonicalUsername: "garden_talk" });
    f.store.setMembership(account, "garden_talk", { state: "pending" }, f.deps.now());
    expect(await ownerJoin(d, f.deps.now, async () => null, "garden_talk")).toMatchObject({ ok: false });
    expect(f.joins()).toBe(0);
    f.store.close();
  });

  it("never changes the verified peer while recovering an owner join's stale hash", async () => {
    const f = setup();
    let calls = 0;
    f.reader.join = async () => { calls += 1; throw new PeerUnknownError("-10011"); };
    f.reader.resolve = async () => ({ peerId: "-10099", title: "replacement", accessHash: "88", canonicalUsername: "garden_talk", kind: "group", isMember: false });
    const { llm } = fakeLlm(() => ({ content: "{}" }));
    const watcher = createWatcher({ project: "acme", config: f.config, lens: await acmeLens(), store: f.store, llm, reader: () => f.reader, queue: f.queue, now: f.deps.now,
      membership: { account: () => account, policy: f.deps.policy } });
    expect(await watcher.join("garden_talk")).toMatchObject({ ok: false });
    expect(calls).toBe(1);
    expect(f.store.group("garden_talk")?.peerId).toBe("-10011");
    f.store.close();
  });

  it("refuses an owner join when its membership becomes pending while the account is busy", async () => {
    const f = setup();
    let busy = false;
    f.onInspect(() => { busy = true; });
    const queue = createWatchQueue({ owner: { busy: () => busy }, account: { id: account, journal: accountJournal(join(mkdtempSync(join(tmpdir(), "membership-wait-")), "accounts.json")), joinsPerDay: () => 3 },
      clock: { now: () => f.deps.now().getTime(), random: () => 0, sleep: async (ms) => { f.time(ms); busy = false; f.store.setMembership(account, "garden_talk", { state: "pending" }, f.deps.now()); } } });
    const { llm } = fakeLlm(() => ({ content: "{}" }));
    const d = { project: "acme", config: f.config, lens: await acmeLens(), store: f.store, llm, reader: () => f.reader, queue,
      membership: { account: () => account, policy: f.deps.policy } };
    expect(await ownerJoin(d, f.deps.now, async () => null, "garden_talk")).toMatchObject({ ok: false });
    expect(f.joins()).toBe(0);
    expect(f.store.membership(account, "garden_talk")?.state).toBe("pending");
    f.store.close();
  });
});
