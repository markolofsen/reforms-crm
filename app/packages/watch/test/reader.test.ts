import { describe, expect, it } from "vitest";
import type { WatchConfig } from "../src/config";
import { createWatchQueue, HISTORY_GAP_MS, RESOLVES_PER_DAY, WatchBudgetSpent, WatchParked } from "../src/reader/queue";
import { BACKOFF_BASE_MS, createWatcher, FloodWaitError, PeerUnknownError, type PublicPeer, type PublicReader } from "../src/reader/poller";
import { acmeLens, answer, fakeLlm, tempStore } from "./support";

// P144 W4 with fakes only: no Telegram call is made by any test. The reader has three methods and no write; the queue keeps the
// watcher's own budget behind the owner's work; a FLOOD_WAIT parks the watcher and nothing else.

/** A fake clock the queue sleeps on: `sleep` moves time forward instead of waiting. */
function clock(start = Date.parse("2026-11-20T10:00:00Z")) {
  let t = start;
  const slept: number[] = [];
  return { now: () => t, sleep: async (ms: number) => void (slept.push(ms), (t += ms)), random: () => 0, slept, advance: (ms: number) => void (t += ms) };
}

const idle = { busy: () => false };

/**
 * A client that forgets peers the way mtcute's session cache does across a restart: a peer is known only after this client
 * resolved it. `fail` makes every history read fail locally (no network answer), as a closed socket would.
 */
function forgetfulReader(o: { fail?: string } = {}) {
  const calls: string[] = [];
  const known = new Set<string>();
  const reader: PublicReader = {
    async resolve(username) {
      calls.push(`resolve ${username}`);
      const peerId = `-100${username.length}`;
      known.add(peerId);
      return { peerId, title: username.toUpperCase() };
    },
    async history(peer, q) {
      calls.push(`history ${peer.title} ${q.minId}`);
      if (o.fail) throw new Error(o.fail);
      if (!known.has(peer.peerId)) throw new PeerUnknownError(peer.peerId);
      return { ok: true, messages: [{ id: q.minId + 1, senderId: "7", senderHandle: null, text: "public text", sentAt: "2026-11-20T09:00:00.000Z" }] };
    },
    async join(peer) {
      calls.push(`join ${peer.title}`);
      if (!known.has(peer.peerId)) throw new PeerUnknownError(peer.peerId);
      return "joined";
    },
  };
  return { reader, calls };
}

/** A fake reader over invented groups; every call is recorded. */
function fakeReader(o: { joinRequired?: string[]; flood?: number; messages?: number } = {}) {
  const calls: string[] = [];
  let next = 1;
  const reader: PublicReader = {
    async resolve(username) {
      calls.push(`resolve ${username}`);
      return username === "nobody_here" ? null : { peerId: `-100${username.length}`, title: username.toUpperCase() };
    },
    async history(peer: PublicPeer, q) {
      calls.push(`history ${peer.title} ${q.minId}`);
      if (o.flood) throw new FloodWaitError(o.flood);
      if (o.joinRequired?.includes((peer.title ?? "").toLowerCase())) return { ok: false, reason: "join_required" };
      const messages = Array.from({ length: o.messages ?? 3 }, () => ({ id: next++, senderId: "7", senderHandle: "@someone", text: `public text ${next}`, sentAt: "2026-11-20T09:00:00.000Z" }));
      return { ok: true, messages };
    },
    async join(peer) {
      calls.push(`join ${peer.title}`);
      return "pending";
    },
  };
  return { reader, calls };
}

const config = (groups: string[], on = true): WatchConfig => ({ lens: "watch-acme", on, account: "default", pollMinutes: 5, groups });

describe("the public reader", () => {
  it("has exactly resolve, inspect, history and join: no send, reaction, mark-read, member list or search", () => {
    // A key added to PublicReader fails this file's typecheck (the record must name every key) and this assertion.
    const keys: Record<keyof PublicReader, true> = { resolve: true, inspect: true, history: true, join: true };
    expect(Object.keys(keys).sort()).toEqual(["history", "inspect", "join", "resolve"]);
  });
});

describe("the watch queue", () => {
  it("spaces history pulls 3 s apart and allows 20 resolves a day", async () => {
    const c = clock();
    const q = createWatchQueue({ owner: idle, clock: c });
    await q.run("history", async () => 1);
    await q.run("history", async () => 2);
    expect(c.slept).toEqual([HISTORY_GAP_MS]);
    for (let k = 0; k < RESOLVES_PER_DAY; k++) await q.run("resolve", async () => k);
    await expect(q.run("resolve", async () => 0)).rejects.toBeInstanceOf(WatchBudgetSpent);
    c.advance(86_400_000);
    expect(q.resolvesLeft()).toBe(RESOLVES_PER_DAY);
  });

  it("waits while the owner's own Telegram work is in flight", async () => {
    const c = clock();
    let busy = 3;
    const q = createWatchQueue({ owner: { busy: () => busy-- > 0 }, clock: c });
    await q.run("resolve", async () => "ok");
    expect(c.slept).toEqual([500, 500, 500]);
  });

  it("a FLOOD_WAIT parks the queue for the wait plus an hour and names whose call earned it", async () => {
    const c = clock();
    const parks: string[] = [];
    const q = createWatchQueue({ owner: idle, clock: c, onPark: (until) => parks.push(until) });
    await expect(q.run("history", async () => { throw new FloodWaitError(60); })).rejects.toBeInstanceOf(FloodWaitError);
    expect(q.parkedUntil()).toBe(new Date(c.now() + 60_000 + 3_600_000).toISOString());
    expect(q.lastFlood()).toMatchObject({ seconds: 60, by: "watcher", kind: "history" });
    await expect(q.run("resolve", async () => 1)).rejects.toBeInstanceOf(WatchParked);
    expect(parks).toHaveLength(1);
  });

  it("allows at most 3 joins a run, 3 to 4.5 minutes apart", async () => {
    const c = clock();
    const q = createWatchQueue({ owner: idle, clock: c });
    for (let k = 0; k < 3; k++) await q.run("join", async () => k);
    // The first join waits for nothing; each next one 3 to 4.5 minutes after the last.
    expect(c.slept).toHaveLength(2);
    expect(c.slept.every((ms) => ms >= 180_000 && ms <= 270_000)).toBe(true);
    await expect(q.run("join", async () => 0)).rejects.toBeInstanceOf(WatchBudgetSpent);
  });
});

describe("the watcher", () => {
  const setup = async (o: { reader?: PublicReader | null; on?: boolean; groups?: string[] } = {}) => {
    const c = clock();
    const store = tempStore();
    const { llm, transport } = fakeLlm(() => ({ content: answer([{ message_index: 1 }]) }));
    const queue = createWatchQueue({ owner: idle, clock: c });
    const reader = o.reader === undefined ? fakeReader().reader : o.reader;
    const w = createWatcher({ project: "acme", config: config(o.groups ?? ["garden_talk", "tools_and_more"], o.on ?? true), lens: await acmeLens(), store, llm, reader: () => reader, queue, now: () => new Date(c.now()) });
    return { c, store, transport, w };
  };

  it("resolves once, reads without joining, stores the messages, and polls again only after poll_minutes", async () => {
    const { reader, calls } = fakeReader();
    const { c, store, w } = await setup({ reader });
    await w.tick();
    expect(calls).toEqual(["resolve garden_talk", "history GARDEN_TALK 0", "resolve tools_and_more", "history TOOLS_AND_MORE 0"]);
    expect(store.group("garden_talk")).toMatchObject({ access: "open", peerId: "-10011", lastMessageId: 3, newSinceAnalysis: 3 });
    await w.tick();
    expect(calls).toHaveLength(4);
    c.advance(5 * 60_000);
    await w.tick();
    expect(calls.slice(4)).toEqual(["history GARDEN_TALK 3", "history TOOLS_AND_MORE 6"]);
  });

  it("marks a group that must be joined, and joins it only on the owner's word", async () => {
    const { reader, calls } = fakeReader({ joinRequired: ["tools_and_more"] });
    const { store, w } = await setup({ reader });
    await w.tick();
    expect(store.group("tools_and_more")?.access).toBe("join_required");
    expect(calls.filter((x) => x.startsWith("join"))).toEqual([]);
    expect(await w.join("tools_and_more")).toEqual({ ok: true, access: "pending" });
    expect(calls.at(-1)).toBe("join TOOLS_AND_MORE");
    expect(await w.join("not_listed")).toMatchObject({ ok: false });
  });

  it("a FLOOD_WAIT parks the watcher: no further call this tick or the next, and the state says why", async () => {
    const { reader, calls } = fakeReader({ flood: 30 });
    const { c, w } = await setup({ reader });
    await w.tick();
    expect(calls).toEqual(["resolve garden_talk", "history GARDEN_TALK 0"]);
    expect(w.state()).toMatchObject({ state: "parked" });
    c.advance(10 * 60_000);
    await w.tick();
    expect(calls).toHaveLength(2);
  });

  it("reads nothing while the watch list is off or no account is connected", async () => {
    const off = fakeReader();
    const a = await setup({ reader: off.reader, on: false });
    await a.w.tick();
    expect(off.calls).toEqual([]);
    expect(a.w.state()).toEqual({ state: "off" });
    const b = await setup({ reader: null });
    await b.w.tick();
    expect(b.w.state()).toEqual({ state: "no_account" });
  });

  it("runs the analysis of a group once 100 new messages are stored", async () => {
    const { reader } = fakeReader({ messages: 100 });
    const { store, transport, w } = await setup({ reader, groups: ["garden_talk"] });
    await w.tick();
    expect(transport.requests).toHaveLength(1);
    expect(store.moments({}).map((m) => m.messageId)).toEqual([1]);
    expect(store.group("garden_talk")?.newSinceAnalysis).toBe(0);
  });

  it("after a restart, a stored peer the client forgot is resolved again (one of the day's resolves) and read", async () => {
    const c = clock();
    const store = tempStore();
    const { llm } = fakeLlm(() => ({ content: answer([{ message_index: 1 }]) }));
    const lens = await acmeLens();
    const start = (reader: PublicReader) => {
      const queue = createWatchQueue({ owner: idle, clock: c });
      return { queue, w: createWatcher({ project: "acme", config: config(["garden_talk"]), lens, store, llm, reader: () => reader, queue, now: () => new Date(c.now()) }) };
    };
    const before = forgetfulReader();
    await start(before.reader).w.tick();
    expect(before.calls).toEqual(["resolve garden_talk", "history GARDEN_TALK 0"]);
    // The restart: a new client with an empty peer cache, the same store with the peer id.
    c.advance(5 * 60_000);
    const after = forgetfulReader();
    const { queue, w } = start(after.reader);
    await w.tick();
    expect(after.calls).toEqual(["history GARDEN_TALK 1", "resolve garden_talk", "history GARDEN_TALK 1"]);
    expect(store.group("garden_talk")).toMatchObject({ access: "open", lastMessageId: 2, parkedUntil: null });
    expect(queue.resolvesLeft()).toBe(RESOLVES_PER_DAY - 1);
    // Read again next time with no resolve.
    c.advance(5 * 60_000);
    await w.tick();
    expect(after.calls.slice(3)).toEqual(["history GARDEN_TALK 2"]);
  });

  it("Join after a restart resolves the forgotten peer once, then joins", async () => {
    const forgot = forgetfulReader();
    const { store, w } = await setup({ reader: forgot.reader, on: false, groups: ["garden_talk"] });
    store.setGroup("garden_talk", { peerId: "-10011", title: "GARDEN_TALK", access: "join_required" });
    expect(await w.join("garden_talk")).toEqual({ ok: true, access: "joined" });
    expect(forgot.calls).toEqual(["join GARDEN_TALK", "resolve garden_talk", "join GARDEN_TALK"]);
  });

  it("a failing read backs the group off (5 min, then twice as long), says so on its row, and a good read clears it", async () => {
    const broken = forgetfulReader({ fail: "socket closed" });
    let reader: PublicReader = broken.reader;
    const c = clock();
    const store = tempStore();
    const { llm } = fakeLlm(() => ({ content: answer([{ message_index: 1 }]) }));
    const queue = createWatchQueue({ owner: idle, clock: c });
    const w = createWatcher({ project: "acme", config: config(["garden_talk"]), lens: await acmeLens(), store, llm, reader: () => reader, queue, now: () => new Date(c.now()) });
    await w.tick();
    expect(broken.calls).toEqual(["resolve garden_talk", "history GARDEN_TALK 0"]);
    expect(store.group("garden_talk")?.parkReason).toMatch(/could not be read \(socket closed\)/);
    // Ticks every 30 s within the wait make no call.
    for (let k = 0; k < 9; k++) {
      c.advance(30_000);
      await w.tick();
    }
    expect(broken.calls).toHaveLength(2);
    c.advance(BACKOFF_BASE_MS);
    await w.tick();
    expect(broken.calls).toHaveLength(3);
    // The second failure waits twice as long.
    c.advance(BACKOFF_BASE_MS + 1_000);
    await w.tick();
    expect(broken.calls).toHaveLength(3);
    c.advance(BACKOFF_BASE_MS);
    await w.tick();
    expect(broken.calls).toHaveLength(4);
    // The client works again: the read lands and the wait is cleared.
    reader = forgetfulReader().reader;
    c.advance(4 * BACKOFF_BASE_MS + 1_000);
    await w.tick();
    expect(store.group("garden_talk")).toMatchObject({ access: "open", parkedUntil: null, parkReason: null });
  });

  it("keeps the access hash and the day's resolve count in the watch file, so a restart costs no resolve (P153 D4)", async () => {
    const c = clock();
    const store = tempStore();
    const { llm } = fakeLlm(() => ({ content: answer([{ message_index: 1 }]) }));
    const lens = await acmeLens();
    const calls: string[] = [];
    const reader: PublicReader = {
      async resolve(username) {
        calls.push(`resolve ${username}`);
        return { peerId: "-1001234567890", title: "G", accessHash: "987654321" };
      },
      async history(peer, q) {
        calls.push(`history ${peer.accessHash ?? "none"} ${q.minId}`);
        return { ok: true, messages: [] };
      },
      async join() {
        return "joined";
      },
    };
    const start = () => {
      const queue = createWatchQueue({ owner: idle, clock: c, resolvedOn: (day) => store.resolvesOn(day) });
      return { queue, w: createWatcher({ project: "acme", config: config(["garden_talk"]), lens, store, llm, reader: () => reader, queue, now: () => new Date(c.now()) }) };
    };
    const first = start();
    await first.w.tick();
    expect(store.group("garden_talk")).toMatchObject({ peerId: "-1001234567890", accessHash: "987654321" });
    expect(first.queue.resolvesLeft()).toBe(RESOLVES_PER_DAY - 1);
    // The restart: a new queue that counts from the file, and a read with the stored hash, no resolve.
    c.advance(5 * 60_000);
    const second = start();
    expect(second.queue.resolvesLeft()).toBe(RESOLVES_PER_DAY - 1);
    await second.w.tick();
    expect(calls).toEqual(["resolve garden_talk", "history 987654321 0", "history 987654321 0"]);
  });
});

