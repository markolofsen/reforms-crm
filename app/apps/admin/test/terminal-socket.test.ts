import { describe, expect, it } from "vitest";
import { ApiFailure } from "../src/lib/api/client";
import { connectTerminal, retryDelay, type LinkDeps, type LinkState, type SocketHandlers } from "../src/features/terminal/socket";

// The one owner of a session's socket (P49 T3), on a fake socket and fake timers: auth first, the snapshot after `ready`,
// the reconnect schedule, and the two ends that never retry (taken, gone).
function rig(ticket: LinkDeps["ticket"] = async () => ({ ticket: "t1", expiresAt: "2026-11-18T00:00:30.000Z", url: "ws://127.0.0.1:4317/terminal" })) {
  const sockets: { url: string; on: SocketHandlers; sent: (string | Uint8Array)[]; closed: number | null }[] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let n = 0;
  const deps: LinkDeps = {
    ticket,
    open: (url, on) => {
      const s = { url, on, sent: [] as (string | Uint8Array)[], closed: null as number | null };
      sockets.push(s);
      return { send: (d) => void s.sent.push(d), close: (code) => void (s.closed = code ?? 1000) };
    },
    timers: { set: (fn, ms) => (timers.set(++n, { fn, ms }), n), clear: (id) => void timers.delete(id) },
  };
  const states: LinkState[] = [];
  const out: { text: string; snapshot: boolean }[] = [];
  const exits: (number | null)[] = [];
  const link = connectTerminal("s1", { output: (b, snapshot) => out.push({ text: new TextDecoder().decode(b), snapshot }), exit: (c) => exits.push(c), state: (s) => states.push(s) }, deps);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  /** Fires the pending timer with this delay (the reconnect), if one is set. */
  const fire = (ms: number) => {
    for (const [id, t] of timers) if (t.ms === ms) {
      timers.delete(id);
      t.fn();
      return true;
    }
    return false;
  };
  return { link, sockets, timers, states, out, exits, tick, fire };
}

const enc = (s: string) => new TextEncoder().encode(s);

describe("terminal socket", () => {
  it("sends auth first, then the size once ready; the first binary frame after ready is the snapshot", async () => {
    const r = rig();
    await r.tick();
    const s = r.sockets[0]!;
    expect(s.url).toBe("ws://127.0.0.1:4317/terminal");
    r.link.resize(80, 24);
    r.link.input(enc("early"));
    s.on.open();
    expect(s.sent).toEqual([JSON.stringify({ op: "auth", ticket: "t1" })]);
    s.on.text(JSON.stringify({ op: "ready", session: "s1" }));
    expect(s.sent.slice(1, 2)).toEqual([JSON.stringify({ op: "resize", cols: 80, rows: 24 })]);
    expect(new TextDecoder().decode(s.sent[2] as Uint8Array)).toBe("early");
    s.on.bytes(enc("screen so far"));
    s.on.bytes(enc("live"));
    expect(r.out).toEqual([{ text: "screen so far", snapshot: true }, { text: "live", snapshot: false }]);
    expect(r.states.at(-1)).toEqual({ kind: "live" });
  });

  it("reconnects after 1, 2, 5, then 30 s, with a fresh ticket each time, and clears before the next snapshot", async () => {
    expect([0, 1, 2, 3, 4, 9].map(retryDelay)).toEqual([1000, 2000, 5000, 30_000, 30_000, 30_000]);
    let tickets = 0;
    const r = rig(async () => ({ ticket: `t${++tickets}`, expiresAt: "x", url: "ws://127.0.0.1:4317/terminal" }));
    await r.tick();
    r.sockets[0]!.on.close(1006);
    expect(r.states.at(-1)).toEqual({ kind: "retrying", inMs: 1000 });
    expect(r.fire(1000)).toBe(true);
    await r.tick();
    const s = r.sockets[1]!;
    s.on.open();
    expect(s.sent[0]).toBe(JSON.stringify({ op: "auth", ticket: "t2" }));
    s.on.text(JSON.stringify({ op: "ready", session: "s1" }));
    s.on.bytes(enc("again"));
    expect(r.out.at(-1)).toEqual({ text: "again", snapshot: true });
  });

  it("stops for good when another window takes the session, until Take back", async () => {
    const r = rig();
    await r.tick();
    r.sockets[0]!.on.text(JSON.stringify({ op: "taken" }));
    expect(r.states.at(-1)).toEqual({ kind: "taken" });
    r.sockets[0]!.on.close(4409);
    expect(r.timers.size).toBe(0);
    r.link.takeBack();
    await r.tick();
    expect(r.sockets).toHaveLength(2);
  });

  it("a missing session (4404, or a 404 on the ticket) ends the link without a retry; an exit leaves the screen and does not reconnect", async () => {
    const gone = rig(async () => Promise.reject(new ApiFailure("No such session.", "not_found", 404)));
    await gone.tick();
    expect(gone.states.at(-1)).toEqual({ kind: "gone" });
    expect(gone.timers.size).toBe(0);
    const r = rig();
    await r.tick();
    r.sockets[0]!.on.text(JSON.stringify({ op: "ready", session: "s1" }));
    r.sockets[0]!.on.text(JSON.stringify({ op: "exit", code: 3 }));
    r.sockets[0]!.on.close(1000);
    expect(r.exits).toEqual([3]);
    expect([...r.timers.values()].filter((t) => t.ms !== 20_000)).toEqual([]);
  });

  it("close ends it: the socket is closed and nothing is scheduled", async () => {
    const r = rig();
    await r.tick();
    r.link.close();
    expect(r.sockets[0]!.closed).toBe(1000);
    r.sockets[0]!.on.close(1006);
    expect(r.timers.size).toBe(0);
  });
});
