import { createServer } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { holdIdleSockets, KEEP_ALIVE_MS, listenErrorLine, onShutdown } from "./lifecycle";

afterEach(() => { vi.useRealTimers(); });

describe("a taken port", () => {
  it("is one line naming the port, for the error a real second listener gets", async () => {
    const first = createServer();
    await new Promise<void>((r) => first.listen(0, "127.0.0.1", r));
    const port = (first.address() as { port: number }).port;
    const err = await new Promise<unknown>((r) => { const second = createServer(); second.once("error", r); second.listen(port, "127.0.0.1"); });
    first.close();
    const line = listenErrorLine(err, "127.0.0.1", port)!;
    expect(line).toContain(`port ${port} on 127.0.0.1 is already in use`);
    expect(line).toContain("api_port");
    expect(line.split("\n")).toHaveLength(1);
  });
  it("leaves every other error to be thrown with its stack", () => {
    expect(listenErrorLine(new Error("boom"), "127.0.0.1", 1)).toBeUndefined();
    expect(listenErrorLine(null, "127.0.0.1", 1)).toBeUndefined();
  });
});

describe("shutdown", () => {
  const rig = (stop: () => Promise<void>) => {
    const handlers: Record<string, () => void> = {};
    const exits: number[] = [];
    const logs: string[] = [];
    onShutdown({ stop, exit: (c) => exits.push(c), deadlineMs: 5000, log: (l) => logs.push(l), signals: { on: (s, f) => { handlers[s] = f; } } });
    return { handlers, exits, logs };
  };
  it("exits 0 once everything has stopped", async () => {
    const r = rig(async () => {});
    r.handlers.SIGTERM!();
    await vi.waitFor(() => expect(r.exits).toEqual([0]));
  });
  it("exits 1 at the deadline when a poller never stops, and says so", async () => {
    vi.useFakeTimers();
    const r = rig(() => new Promise(() => {}));
    r.handlers.SIGTERM!();
    r.handlers.SIGINT!(); // a second signal while stopping changes nothing
    await vi.advanceTimersByTimeAsync(4999);
    expect(r.exits).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.exits).toEqual([1]);
    expect(r.logs[0]).toContain("still stopping after 5 s");
  });
  it("exits 1 and says why when stopping throws", async () => {
    const r = rig(async () => { throw new Error("poller blew up"); });
    r.handlers.SIGINT!();
    await vi.waitFor(() => expect(r.exits).toEqual([1]));
    expect(r.logs[0]).toContain("poller blew up");
  });
});

describe("idle keep-alive sockets (the /api proxy's ECONNRESET)", () => {
  it("the server keeps an idle socket two minutes and says so in its Keep-Alive hint, so the proxy frees it first", async () => {
    const { createServer: httpServer, request, Agent } = await import("node:http");
    const server = httpServer((_req, res) => res.end("ok"));
    holdIdleSockets(server);
    expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_MS);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
    expect(server.headersTimeout).toBeLessThanOrEqual(server.requestTimeout);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const agent = new Agent({ keepAlive: true });
    try {
      const get = () => new Promise<{ hint: string | undefined; socket: unknown }>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port, path: "/", agent }, (res) => { res.resume(); res.on("end", () => resolve({ hint: String(res.headers["keep-alive"]), socket: req.socket })); });
        req.on("error", reject);
        req.end();
      });
      const first = await get();
      expect(first.hint).toBe(`timeout=${KEEP_ALIVE_MS / 1000}`);
      // Past Node's old 5 s default the same socket is reused, not closed under the proxy.
      await new Promise((r) => setTimeout(r, 5_600));
      const second = await get();
      expect(second.socket).toBe(first.socket);
    } finally {
      agent.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 15_000);
});
