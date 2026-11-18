import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hubPaths, type HubPaths } from "@hub/config/paths";
import type { Repos } from "@hub/db";
import type { PtyProcess, PtySpawn } from "@hub/terminal";
import { ticketStore } from "./admin-gate";
import { createApp } from "./app";
import { chooseShell, createTerminal, TERMINAL_PATH } from "./terminal";

// The terminal's doors (P49 S1 to S7), on a fake PTY: nothing here starts a shell.

const ADMIN_PORT = 5173;
const API = "http://127.0.0.1:4317";
const ADMIN = { "content-type": "application/json", host: "127.0.0.1:4317", origin: `http://127.0.0.1:${ADMIN_PORT}`, "sec-fetch-site": "same-origin" };
const repos = { projects: { get: async (s: string) => (s === "acme" ? { slug: "acme" } : null) } } as unknown as Repos;

let home: string;
let paths: HubPaths;
let spawned: Array<{ file: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string; written: string[]; emit: (d: string) => void }>;
let server: Server | null = null;

const spawn: PtySpawn = (file, args, o) => {
  let emit: (d: string) => void = () => {};
  const rec = { file, args, env: o.env, cwd: o.cwd, written: [] as string[], emit: (d: string) => emit(d) };
  spawned.push(rec);
  const p: PtyProcess = { pid: 7, onData: (cb) => { emit = cb; }, onExit: () => {}, write: (d) => rec.written.push(d), resize: () => {}, kill: () => {}, pause: () => {}, resume: () => {} };
  return p;
};

const config = (cfg: Record<string, unknown>) => writeFileSync(paths.configFile, JSON.stringify(cfg));
function setup(o: { now?: () => number } = {}) {
  const terminal = createTerminal({ paths, repos, adminPort: ADMIN_PORT, apiPort: 4317, spawn, fakeShell: false, env: { PATH: "/usr/bin", SHELL: "/bin/zsh", HUB_MAILER: "fake", HUB_DB: "/x.db", LANG: "C" }, nodeBin: "/n22/bin/node", tickets: ticketStore({ ttlMs: 30_000, ...(o.now ? { now: o.now } : {}) }) });
  const app = createApp(repos, { terminal, adminPort: ADMIN_PORT });
  const call = (method: string, p: string, body?: unknown, headers: Record<string, string> = ADMIN) => app.request(`${API}${p}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { terminal, app, call };
}

/** A raw upgrade request: the status the server answers (101 when it hands the socket on). */
async function upgrade(terminal: ReturnType<typeof createTerminal>, p: string, headers: Record<string, string>): Promise<number> {
  server = createServer();
  server.on("upgrade", terminal.upgrade);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: p, headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers } });
    req.on("upgrade", (res, socket) => { socket.destroy(); resolve(res.statusCode ?? 0); });
    req.on("response", (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on("error", reject);
    req.end();
  });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hub-server-terminal-"));
  mkdirSync(join(home, "config"), { recursive: true });
  paths = hubPaths({ home, env: {} });
  spawned = [];
});
afterEach(async () => {
  await new Promise((r) => (server ? server.close(r) : r(undefined)));
  server = null;
});

describe("terminal off (the default)", () => {
  it("says so, and every other route and the upgrade are 404", async () => {
    config({});
    const { call, terminal } = setup();
    expect(await (await call("GET", "/api/terminal")).json()).toEqual({ enabled: false });
    expect((await call("POST", "/api/terminal/sessions", { preset: "shell" })).status).toBe(404);
    expect((await call("DELETE", "/api/terminal/sessions/x")).status).toBe(404);
    expect((await call("POST", "/api/terminal/tickets", { session: "x" })).status).toBe(404);
    expect(await upgrade(terminal, TERMINAL_PATH, { origin: ADMIN.origin })).toBe(404);
    expect(spawned).toEqual([]);
  });
  it("a value that is not exactly true leaves it off", async () => {
    config({ terminal: { enabled: "true" } });
    expect(await (await setup().call("GET", "/api/terminal")).json()).toEqual({ enabled: false });
  });
});

describe("terminal on", () => {
  beforeEach(() => config({ terminal: { enabled: true }, agent: { default: "codex", unattended: true } }));

  it("offers the presets from the server's table, default CLI first", async () => {
    const s = (await (await setup().call("GET", "/api/terminal")).json()) as { enabled: boolean; unattended: boolean; presets: string[]; sessions: unknown[] };
    expect(s).toMatchObject({ enabled: true, unattended: true, presets: ["codex", "claude", "shell"], sessions: [] });
  });
  it("a preset runs hub agent in the instance, with the server's Node first and none of the server's switches", async () => {
    const { call } = setup();
    const r = await call("POST", "/api/terminal/sessions", { preset: "claude", project: "acme" });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ title: "acme · Claude Code", preset: "claude", project: "acme", state: "running" });
    const p = spawned[0]!;
    expect([p.file, p.args, p.cwd]).toEqual(["/bin/zsh", ["-l", "-i"], home]);
    expect(p.env).toMatchObject({ HUB_HOME: home, HUB_PROJECT: "acme", PATH: "/n22/bin:/usr/bin", TERM: "xterm-256color" });
    expect(p.env.HUB_MAILER).toBeUndefined();
    expect(p.env.HUB_DB).toBeUndefined();
    p.emit("% ");
    expect(p.written).toEqual([`'/n22/bin/node' '${paths.hubBin}' agent acme --cli claude\r`]);
  });
  it("refuses an unknown preset or a command field (400), an unknown project (404), a CLI without a project (400)", async () => {
    const { call } = setup();
    expect((await call("POST", "/api/terminal/sessions", { preset: "bash" })).status).toBe(400);
    expect((await call("POST", "/api/terminal/sessions", { preset: "shell", command: "rm -rf ~" })).status).toBe(400);
    expect((await call("POST", "/api/terminal/sessions", { preset: "shell", cwd: "/" })).status).toBe(400);
    expect((await call("POST", "/api/terminal/sessions", { preset: "claude", project: "nobody" })).status).toBe(404);
    expect((await call("POST", "/api/terminal/sessions", { preset: "codex" })).status).toBe(400);
    expect((await call("POST", "/api/terminal/sessions", { preset: "shell" })).status).toBe(201);
    expect(spawned).toHaveLength(1);
  });
  it("a ticket needs the admin's exact origin, a same-origin fetch and a loopback Host", async () => {
    const { call } = setup();
    const s = (await (await call("POST", "/api/terminal/sessions", { preset: "shell" })).json()) as { id: string };
    const body = { session: s.id };
    const { origin: _o, ...noOrigin } = ADMIN;
    expect((await call("POST", "/api/terminal/tickets", body, noOrigin)).status).toBe(403);
    expect((await call("POST", "/api/terminal/tickets", body, { ...ADMIN, origin: "null" })).status).toBe(403);
    expect((await call("POST", "/api/terminal/tickets", body, { ...ADMIN, origin: "http://127.0.0.1:5999" })).status).toBe(403);
    expect((await call("POST", "/api/terminal/tickets", body, { ...ADMIN, "sec-fetch-site": "same-site" })).status).toBe(403);
    expect((await call("POST", "/api/terminal/tickets", body, { ...ADMIN, host: "evil.example:4317" })).status).toBe(403);
    expect((await call("POST", "/api/terminal/tickets", { session: "nope" })).status).toBe(404);
    const t = await call("POST", "/api/terminal/tickets", body);
    expect(t.status).toBe(200);
    expect(await t.json()).toMatchObject({ url: `ws://127.0.0.1:4317${TERMINAL_PATH}` });
  });
  it("a ticket is single use, bound to its session, and dies after 30 s", () => {
    let now = 1_000;
    const tickets = ticketStore({ ttlMs: 30_000, now: () => now });
    const a = tickets.mint("term:s1");
    expect(tickets.redeem(a.ticket)).toBe("term:s1");
    expect(tickets.redeem(a.ticket)).toBeNull();
    const b = tickets.mint("term:s1");
    expect(tickets.take(b.ticket, "term:s2")).toBe(false);
    expect(tickets.take(b.ticket, "term:s1")).toBe(false);
    const c = tickets.mint("term:s1");
    now += 30_001;
    expect(tickets.redeem(c.ticket)).toBeNull();
  });
  it("closing a tab forgets it; an unknown one is 404", async () => {
    const { call } = setup();
    const s = (await (await call("POST", "/api/terminal/sessions", { preset: "shell" })).json()) as { id: string };
    expect(await (await call("DELETE", `/api/terminal/sessions/${s.id}`)).json()).toEqual({ ok: true });
    expect((await call("DELETE", `/api/terminal/sessions/${s.id}`)).status).toBe(404);
  });
  it("the upgrade: wrong path 404, a query string 400 (a ticket in the URL would be logged), a foreign origin 403, the admin 101", async () => {
    const { terminal } = setup();
    const h = { host: "127.0.0.1:4317", origin: ADMIN.origin };
    expect(await upgrade(terminal, "/other", h)).toBe(404);
    await new Promise((r) => server!.close(r));
    expect(await upgrade(terminal, `${TERMINAL_PATH}?ticket=x`, h)).toBe(400);
    await new Promise((r) => server!.close(r));
    expect(await upgrade(terminal, TERMINAL_PATH, { ...h, origin: "http://127.0.0.1:5999" })).toBe(403);
    await new Promise((r) => server!.close(r));
    expect(await upgrade(terminal, TERMINAL_PATH, { host: "127.0.0.1:4317" })).toBe(403);
    await new Promise((r) => server!.close(r));
    expect(await upgrade(terminal, TERMINAL_PATH, { ...h, host: "rebind.example:4317" })).toBe(403);
    await new Promise((r) => server!.close(r));
    expect(await upgrade(terminal, TERMINAL_PATH, h)).toBe(101);
    terminal.stop();
  });
});

describe("HUB_TERMINAL_SHELL", () => {
  it("is the login shell unset, the fake only with HUB_DB, and nothing else", () => {
    expect(chooseShell({})).toBe("login");
    expect(chooseShell({ HUB_TERMINAL_SHELL: "fake", HUB_DB: "/tmp/x.db" })).toBe("fake");
    expect(() => chooseShell({ HUB_TERMINAL_SHELL: "fake" })).toThrow(/needs HUB_DB/);
    expect(() => chooseShell({ HUB_TERMINAL_SHELL: "/bin/bash" })).toThrow(/unset or "fake"/);
  });
});
