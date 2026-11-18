import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bumpTopic, createRepos, LIVE_TABLES, liveSeq, openDb, type DbHandle, type Repos } from "@hub/db";
import { MAX_LIVE_SUBSCRIBERS, parseLiveEvent, type LiveEvent } from "@hub/contract/live";
import { createApp } from "./app";
import { changesOf, createLive, resumeOf, TABLE_TOPIC, type LiveService, type LiveSink } from "./live";

// P50 L2: the tailer, the frames, resume and reset, backpressure, the cap, and the route's guards.
let handle: DbHandle;
let repos: Repos;
let live: LiveService;

const eventsOf = (frames: string[]): LiveEvent[] =>
  frames.join("").split("\n\n").flatMap((f) => {
    const data = f.split("\n").find((l) => l.startsWith("data: "));
    const e = data ? parseLiveEvent(data.slice(6)) : null;
    return e ? [e] : [];
  });

/** A sink that takes every frame at once, or holds them while `hold` is set (a slow client). */
type TestSink = LiveSink & { frames: string[]; closed: boolean; hold: boolean; release: () => void };
function sink(): TestSink {
  const frames: string[] = [];
  let release: (() => void) | null = null;
  const s: TestSink = {
    frames,
    closed: false,
    hold: false,
    release: () => { const r = release; release = null; r?.(); },
    send: (f: string) => {
      frames.push(f);
      return s.hold ? new Promise<void>((r) => (release = r)) : Promise.resolve();
    },
    close: () => { s.closed = true; },
  };
  return s;
}

beforeEach(() => {
  vi.useFakeTimers();
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  live = createLive({ db: handle.db, watch: [] });
});
afterEach(() => {
  live.stop();
  handle.close();
  vi.useRealTimers();
});

describe("live service", () => {
  it("hello first, then a change naming the topic and the project, with the counter as its id", async () => {
    const s = sink();
    live.subscribe(s, undefined);
    expect(eventsOf(s.frames)).toEqual([{ type: "hello", seq: 0, apiVersion: expect.any(Number) }]);
    expect(s.frames[0]).toContain("retry: 1000");
    const clientId = await repos.clients.create({ project: "acme", email: "a@x.example", name: "A" });
    await repos.drafts.create({ project: "acme", clientId, subject: "s", toAddr: "a@x.example", body: "b", status: "ready" });
    await vi.advanceTimersByTimeAsync(400);
    const n = liveSeq(handle.db);
    const change = eventsOf(s.frames).at(-1);
    expect(change).toMatchObject({ type: "change", seq: n });
    expect(change?.type === "change" && change.changes).toEqual(expect.arrayContaining([{ topic: "clients", project: "acme" }, { topic: "drafts", project: "acme" }]));
    expect(s.frames.at(-1)).toMatch(new RegExp(`^id: ${n}\n`));
  });

  it("writes within one coalesce window arrive as one frame", async () => {
    const s = sink();
    live.subscribe(s, undefined);
    await vi.advanceTimersByTimeAsync(200); // the tick that will see the writes
    for (let i = 0; i < 5; i++) await repos.clients.create({ project: "acme", email: `a${i}@x.example`, name: "A" });
    await vi.advanceTimersByTimeAsync(350);
    expect(eventsOf(s.frames).filter((e) => e.type === "change")).toHaveLength(1);
  });

  it("a Last-Event-ID below the counter gets only what is newer; above it or garbage gets a reset", async () => {
    await repos.clients.create({ project: "a", email: "a@x.example", name: "A" });
    const mid = liveSeq(handle.db);
    const n = bumpTopic(handle.db, "connections", null);
    const resumed = sink();
    live.subscribe(resumed, String(mid));
    expect(eventsOf(resumed.frames)).toEqual([expect.objectContaining({ type: "hello", seq: n }), { type: "change", seq: n, changes: [{ topic: "connections", project: null }] }]);
    const current = sink();
    live.subscribe(current, String(n));
    expect(eventsOf(current.frames).map((e) => e.type)).toEqual(["hello"]);
    for (const bad of ["99", "abc", "-1", "1.5"]) {
      const s = sink();
      live.subscribe(s, bad);
      expect(eventsOf(s.frames).map((e) => e.type), bad).toEqual(["hello", "reset"]);
    }
  });

  it("a client still busy when the next batch comes gets a reset, not a growing queue", async () => {
    const s = sink();
    s.hold = true;
    live.subscribe(s, undefined); // hello is held
    for (let i = 0; i < 3; i++) {
      await repos.clients.create({ project: "a", email: `a${i}@x.example`, name: "A" });
      await vi.advanceTimersByTimeAsync(400);
    }
    expect(s.frames).toHaveLength(1); // only the held hello went out
    s.hold = false;
    s.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(eventsOf(s.frames).map((e) => e.type)).toEqual(["hello", "reset"]);
  });

  it("pings every 15 s", async () => {
    const s = sink();
    live.subscribe(s, undefined);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(s.frames.filter((f) => f === ": ping\n\n")).toHaveLength(2);
  });

  it("refuses the 17th subscriber, and an unsubscribed stream frees its place", () => {
    const subs = Array.from({ length: MAX_LIVE_SUBSCRIBERS }, () => live.subscribe(sink(), undefined));
    expect(live.full()).toBe(true);
    expect(live.subscribe(sink(), undefined)).toBeNull();
    subs[0]?.unsubscribe();
    expect(live.count()).toBe(MAX_LIVE_SUBSCRIBERS - 1);
    expect(live.subscribe(sink(), undefined)).not.toBeNull();
  });

  it("stop closes every stream", () => {
    const a = sink();
    const b = sink();
    live.subscribe(a, undefined);
    live.subscribe(b, undefined);
    live.stop();
    expect([a.closed, b.closed, live.count()]).toEqual([true, true, 0]);
  });

  it("a watched source that changes bumps its topic once", async () => {
    live.stop();
    let state = "running";
    live = createLive({ db: handle.db, watch: [{ topic: "health", signature: () => state, everyMs: 1000 }] });
    const s = sink();
    live.subscribe(s, undefined);
    await vi.advanceTimersByTimeAsync(2000);
    expect(eventsOf(s.frames).map((e) => e.type)).toEqual(["hello"]);
    state = "error";
    await vi.advanceTimersByTimeAsync(1400);
    expect(eventsOf(s.frames).at(-1)).toMatchObject({ type: "change", changes: [{ topic: "health", project: null }] });
  });

  it("every table has a topic, and an unknown name is ignored", () => {
    expect(Object.keys(TABLE_TOPIC).sort()).toEqual([...LIVE_TABLES].sort());
    expect(changesOf([{ tbl: "a_newer_table", project: "p", seq: 1 }, { tbl: "topic:nope", project: "", seq: 2 }])).toEqual([]);
    expect(resumeOf(undefined, 3)).toBe("none");
  });
});

describe("GET /api/live", () => {
  const url = "http://127.0.0.1:4317/api/live";
  it("streams text/event-stream with no-transform and no CORS header, hello first", async () => {
    const app = createApp(repos, { live });
    const ctl = new AbortController();
    const res = await app.request(url, { signal: ctl.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const reader = res.body?.getReader();
    const first = await reader?.read();
    expect(eventsOf([new TextDecoder().decode(first?.value)])[0]?.type).toBe("hello");
    expect(live.count()).toBe(1);
    ctl.abort();
    await reader?.cancel().catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(live.count()).toBe(0);
  });

  it("a foreign Host or Origin is refused; without the service it is 404; when full it is 503", async () => {
    const app = createApp(repos, { live });
    expect((await app.request("http://evil.example/api/live")).status).toBe(403);
    expect((await app.request(url, { headers: { origin: "http://evil.example" } })).status).toBe(403);
    expect((await createApp(repos).request(url)).status).toBe(404);
    for (let i = 0; i < MAX_LIVE_SUBSCRIBERS; i++) live.subscribe(sink(), undefined);
    expect((await app.request(url)).status).toBe(503);
  });
});
