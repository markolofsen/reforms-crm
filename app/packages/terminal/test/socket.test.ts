import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { CLOSE } from "@hub/contract/terminal";
import { sessionManager, terminalSocketServer, type PtyProcess, type PtySpawn, type SpawnSpec } from "../src/index";

// The socket protocol (S6): nothing of the PTY before a valid ticket as the first frame, within the auth window.

function fake() {
  const written: string[] = [];
  const sizes: Array<[number, number]> = [];
  let emit: (d: string) => void = () => {};
  const spawn: PtySpawn = () => {
    const p: PtyProcess = { pid: 1, onData: (cb) => { emit = cb; }, onExit: () => {}, write: (d) => written.push(d), resize: (c, r) => sizes.push([c, r]), kill: () => {}, pause: () => {}, resume: () => {} };
    return p;
  };
  return { spawn, written, sizes, emit: (d: string) => emit(d) };
}

const spec: SpawnSpec = { preset: "shell", project: null, title: "Shell", file: "/bin/sh", args: [], cwd: "/", env: {}, command: null };
let server: Server | null = null;

async function serve(redeem: (t: string) => string | null, manager: ReturnType<typeof sessionManager>, authMs = 2000) {
  const wss = terminalSocketServer();
  server = createServer();
  server.on("upgrade", (req, socket, head) => wss.accept(req, socket, head, { manager, redeem, authMs }));
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}/terminal`;
}

const closed = (ws: WebSocket) => new Promise<number>((r) => ws.on("close", (code) => r(code)));
const opened = (ws: WebSocket) => new Promise<void>((r) => ws.on("open", () => r()));

afterEach(async () => {
  await new Promise((r) => (server ? server.close(r) : r(undefined)));
  server = null;
});

describe("the terminal socket", () => {
  it("closes 4401 when no ticket arrives in the auth window", async () => {
    const url = await serve(() => null, sessionManager({ spawn: fake().spawn }), 150);
    const ws = new WebSocket(url);
    expect(await closed(ws)).toBe(CLOSE.unauthorized);
  });
  it("closes 4401 on a bad ticket and on a binary first frame; 4404 for a ticket whose session is gone", async () => {
    const m = sessionManager({ spawn: fake().spawn });
    const url = await serve((t) => (t === "gone" ? "no-such-session" : null), m);
    const a = new WebSocket(url);
    await opened(a);
    a.send(JSON.stringify({ op: "auth", ticket: "wrong" }));
    expect(await closed(a)).toBe(CLOSE.unauthorized);
    const b = new WebSocket(url);
    await opened(b);
    b.send(Buffer.from("ls\r"));
    expect(await closed(b)).toBe(CLOSE.unauthorized);
    const c = new WebSocket(url);
    await opened(c);
    c.send(JSON.stringify({ op: "auth", ticket: "gone" }));
    expect(await closed(c)).toBe(CLOSE.notFound);
  });
  it("with a valid ticket: ready, then binary out; binary in reaches the PTY, resize is clamped, ping answers pong", async () => {
    const f = fake();
    const m = sessionManager({ spawn: f.spawn, batchMs: 2 });
    const s = m.create(spec);
    const url = await serve((t) => (t === "good" ? s.id : null), m);
    const ws = new WebSocket(url);
    const text: unknown[] = [];
    const bin: string[] = [];
    ws.on("message", (d, isBinary) => (isBinary ? bin.push(d.toString()) : text.push(JSON.parse(d.toString()))));
    await opened(ws);
    ws.send(JSON.stringify({ op: "auth", ticket: "good" }));
    await new Promise((r) => setTimeout(r, 100));
    expect(text[0]).toEqual({ op: "ready", session: s.id });
    f.emit("hello");
    ws.send(Buffer.from("ls\r"));
    ws.send(JSON.stringify({ op: "resize", cols: 1, rows: 99999 }));
    ws.send(JSON.stringify({ op: "ping" }));
    await new Promise((r) => setTimeout(r, 100));
    expect(bin.join("")).toContain("hello");
    expect(f.written).toContain("ls\r");
    expect(f.sizes.at(-1)).toEqual([2, 500]);
    expect(text).toContainEqual({ op: "pong" });
    ws.close();
  });
});
