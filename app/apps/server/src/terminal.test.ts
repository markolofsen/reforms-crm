import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hubPaths, type HubPaths } from "@hub/config/paths";
import type { Repos } from "@hub/db";
import type { PtyProcess, PtySpawn } from "@hub/terminal";
import { cliDetector, type CliFact } from "@hub/agent/detect";
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
const fact = (cli: "claude" | "codex", state: CliFact["state"]): CliFact => ({ cli, state, path: `/u/bin/${cli}`, version: state === "missing" ? null : "1.0.0", detail: `${cli} ${state}`, fix: state === "ready" ? null : `fix ${cli}` });
let detects = 0;
function setup(o: { now?: () => number; facts?: CliFact[]; detectMs?: number } = {}) {
  // Never the real login shell here: the detector answers the facts given (both ready by default) and counts its runs.
  const detector = cliDetector({ detect: async () => { detects++; if (o.detectMs) await new Promise((r) => setTimeout(r, o.detectMs)); return o.facts ?? [fact("claude", "ready"), fact("codex", "ready")]; } });
  const terminal = createTerminal({ paths, repos, adminPort: ADMIN_PORT, apiPort: 4317, spawn, fakeShell: false, env: { PATH: "/usr/bin", SHELL: "/bin/zsh", HUB_MAILER: "fake", HUB_DB: "/x.db", LANG: "C" }, nodeBin: "/n22/bin/node", tickets: ticketStore({ ttlMs: 30_000, ...(o.now ? { now: o.now } : {}) }), detector });
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
  detects = 0;
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
    const r = await call("POST", "/api/terminal/sessions", { preset: "claude", project: "acme", theme: "dark" });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ title: "acme · Claude Code", preset: "claude", project: "acme", state: "running" });
    const p = spawned[0]!;
    // The agent is the spawn's argv, exec'd by the login shell: nothing is typed into a prompt (v0.9.1's corrupted first key).
    expect([p.file, p.args, p.cwd]).toEqual(["/bin/zsh", ["-l", "-i", "-c", 'exec "$0" "$@"', "/n22/bin/node", paths.hubBin, "agent", "acme", "--cli", "claude"], home]);
    expect(p.env).toMatchObject({ HUB_HOME: home, HUB_PROJECT: "acme", PATH: "/n22/bin:/usr/bin", TERM: "xterm-256color" });
    expect(p.env.HUB_MAILER).toBeUndefined();
    expect(p.env.COLORFGBG).toBe("15;0");
    expect(p.env.HUB_DB).toBeUndefined();
    p.emit("% ");
    expect(p.written).toEqual([]);
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

describe("ensure (P57): the column starts the best ready CLI itself, at most one session per project", () => {
  beforeEach(() => config({ terminal: { enabled: true }, agent: { default: "claude", unattended: false } }));
  const argvCli = (n: number) => spawned[n]?.args.at(-1);

  it("starts Claude Code when it is ready; a second ensure returns the running session and spawns nothing", async () => {
    const { call } = setup();
    const a = await call("POST", "/api/terminal/ensure", { project: "acme" });
    expect(a.status).toBe(201);
    expect(await a.json()).toMatchObject({ created: true, why: null, session: { preset: "claude", project: "acme", state: "running" } });
    const b = await call("POST", "/api/terminal/ensure", { project: "acme" });
    expect(b.status).toBe(200);
    expect(await b.json()).toMatchObject({ created: false, session: { preset: "claude" } });
    expect(spawned).toHaveLength(1);
    expect(argvCli(0)).toBe("claude");
  });
  it("on a cold detector (server just started, detection still running) ensure waits for it and starts Claude Code, not Shell", async () => {
    const { call, terminal } = setup({ detectMs: 300 });
    const before = detects;
    terminal.warm(); // the start-up detection, still running when the first ensure arrives
    expect(terminal.detector.peek()).toBeNull();
    const r = await call("POST", "/api/terminal/ensure", { project: "acme" });
    expect(await r.json()).toMatchObject({ created: true, why: null, session: { preset: "claude", project: "acme" } });
    expect(detects - before).toBe(1); // joined the running detection, not a second one
    expect(argvCli(spawned.length - 1)).toBe("claude");
  });
  it("two ensures at once spawn once (single flight per project)", async () => {
    const { call } = setup();
    const [a, b] = await Promise.all([call("POST", "/api/terminal/ensure", { project: "acme" }), call("POST", "/api/terminal/ensure", { project: "acme" })]);
    const ids = [((await a.json()) as { session: { id: string } }).session.id, ((await b.json()) as { session: { id: string } }).session.id];
    expect(ids[0]).toBe(ids[1]);
    expect(spawned).toHaveLength(1);
  });
  it("Claude not signed in and Codex ready: Codex, with the one line that says why", async () => {
    const { call } = setup({ facts: [fact("claude", "signed-out"), fact("codex", "ready")] });
    const r = (await (await call("POST", "/api/terminal/ensure", { project: "acme" })).json()) as { session: { preset: string }; why: string };
    expect(r.session.preset).toBe("codex");
    expect(r.why).toBe("Codex: Claude Code is not signed in · fix claude");
  });
  it("neither CLI installed: a Shell and the install line; no project: a Shell, no line", async () => {
    const { call } = setup({ facts: [fact("claude", "missing"), fact("codex", "missing")] });
    const r = (await (await call("POST", "/api/terminal/ensure", { project: "acme" })).json()) as { session: { preset: string }; why: string };
    expect(r).toMatchObject({ session: { preset: "shell" }, why: "Shell: Claude Code is not installed · fix claude" });
    expect((await (await call("POST", "/api/terminal/ensure", {})).json())).toMatchObject({ created: true, why: null, session: { preset: "shell", project: null } });
  });
  it("an unknown project is 404; ensure and a new session need the exact admin Origin and Sec-Fetch-Site", async () => {
    const { call } = setup();
    expect((await call("POST", "/api/terminal/ensure", { project: "nobody" })).status).toBe(404);
    for (const p of ["/api/terminal/ensure", "/api/terminal/sessions"]) {
      const body = p.endsWith("ensure") ? { project: "acme" } : { preset: "shell" };
      expect((await call("POST", p, body, { ...ADMIN, origin: "http://127.0.0.1:5999" })).status, p).toBe(403);
      const { "sec-fetch-site": _s, ...noFetchSite } = ADMIN;
      expect((await call("POST", p, body, noFetchSite)).status, p).toBe(403);
    }
    expect(spawned).toHaveLength(0);
  });
  it("GET /api/terminal says what the detector found, with no path", async () => {
    const { call, terminal } = setup();
    expect(await (await call("GET", "/api/terminal")).json()).toMatchObject({ clis: [], checkedAt: null });
    await terminal.detector.get();
    const s = (await (await call("GET", "/api/terminal")).json()) as { clis: Array<Record<string, unknown>>; checkedAt: string };
    expect(s.clis.map((c) => [c.cli, c.state])).toEqual([["claude", "ready"], ["codex", "ready"]]);
    expect(JSON.stringify(s.clis)).not.toContain("/u/bin");
    expect(typeof s.checkedAt).toBe("string");
    expect(detects).toBe(1);
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
