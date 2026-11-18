import { expect, test } from "@playwright/test";
import { networkInterfaces } from "node:os";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";

// Decision 0015 section 3 and the N1 proxy: the admin answers loopback names only, refuses a mutating call whose Origin is
// foreign, and listens on 127.0.0.1 and nowhere else. Nothing here writes: every refused call is refused before it runs.
const UI = Number(process.env.HUB_E2E_UI_PORT);
const API = Number(process.env.HUB_E2E_API_PORT);

test("a foreign Host is 403 on a page and on /api", async ({ request }) => {
  for (const path of ["/drafts", "/api/pulse"]) {
    const res = await request.get(path, { headers: { host: "evil.test" } });
    expect(res.status(), path).toBe(403);
  }
  for (const host of ["localhost", `127.0.0.1:${UI}`]) expect((await request.get("/api/pulse", { headers: { host } })).status(), host).toBe(200);
});

test("a mutating call with a foreign Origin is 403 (reads too); without one it passes", async ({ request }) => {
  const evil = await request.post("/api/projects/lisbon-realty/sends/resume", { headers: { origin: "http://evil.test" } });
  expect(evil.status()).toBe(403);
  expect(await evil.json()).toMatchObject({ code: "forbidden" });
  // the API itself also refuses a foreign Origin on a read (apps/server/src/app.ts); the same read without one is served
  expect((await request.get("/api/pulse", { headers: { origin: "http://evil.test" } })).status()).toBe(403);
  expect((await request.get("/api/pulse")).status()).toBe(200);
});

test("the admin listens on 127.0.0.1 only: its port is refused on every other address of this machine", async () => {
  const others = Object.values(networkInterfaces()).flatMap((list) => (list ?? []).filter((i) => i.family === "IPv4" && !i.internal).map((i) => i.address));
  test.skip(others.length === 0, "this machine has no non-loopback IPv4 address to try");
  for (const host of others) {
    const outcome = await new Promise<string>((resolve) => {
      const socket = connect({ host, port: UI, timeout: 3000 });
      socket.once("connect", () => (socket.destroy(), resolve("connected")));
      socket.once("timeout", () => (socket.destroy(), resolve("timeout")));
      socket.once("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? "error"));
    });
    expect(outcome, `${host}:${UI}`).not.toBe("connected");
  }
  const loop = await new Promise<string>((resolve) => {
    const socket = connect({ host: "127.0.0.1", port: UI, timeout: 3000 });
    socket.once("connect", () => (socket.destroy(), resolve("connected")));
    socket.once("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? "error"));
  });
  expect(loop).toBe("connected");
});

// P49 S4 and S5: the terminal's socket and its tickets take the exact admin Origin only, not any loopback port. A page of
// another local server (here the admin's port + 1) is refused on the ticket and on the upgrade; nothing reaches a shell.
test("terminal: a ticket or an upgrade from another loopback port is refused", async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: `http://127.0.0.1:${API}` });
  const ticket = (origin: string) => api.post("/api/terminal/tickets", { headers: { origin, "sec-fetch-site": "same-origin" }, data: { session: "e2e-none" } });
  expect((await ticket(`http://127.0.0.1:${UI + 1}`)).status()).toBe(403);
  expect((await ticket(`http://localhost:${UI + 1}`)).status()).toBe(403);
  // The admin's own origin passes the origin check and gets as far as the session, which does not exist.
  expect((await ticket(`http://127.0.0.1:${UI}`)).status()).toBe(404);
  await api.dispose();

  const outcome = await new Promise<string>((resolve) => {
    const req = httpRequest({
      host: "127.0.0.1",
      port: API,
      path: "/terminal",
      headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "ZTJlLXRlcm1pbmFsLWtleQ==", origin: `http://127.0.0.1:${UI + 1}` },
    });
    req.once("upgrade", (_res, socket) => (socket.destroy(), resolve("upgraded")));
    req.once("response", (res) => (res.resume(), resolve(String(res.statusCode))));
    req.once("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? "error"));
    req.setTimeout(3000, () => (req.destroy(), resolve("timeout")));
    req.end();
  });
  expect(outcome, "the upgrade from a foreign origin").not.toBe("upgraded");
  // A 403 before any upgrade, or the socket dropped without one: either way no shell.
  expect(["403", "ECONNRESET"]).toContain(outcome);
});
