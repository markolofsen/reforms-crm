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
import { appendEvents, logStoreOf } from "@hub/log/store";
import { CODEX_RULES_CHANGED } from "@hub/log/resume";
import { sessionInstructions } from "@hub/agent/session-rules";
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
function setup(o: { now?: () => number; facts?: CliFact[]; detectMs?: number; clock?: () => Date } = {}) {
  // Never the real login shell here: the detector answers the facts given (both ready by default) and counts its runs.
  const detector = cliDetector({ detect: async () => { detects++; if (o.detectMs) await new Promise((r) => setTimeout(r, o.detectMs)); return o.facts ?? [fact("claude", "ready"), fact("codex", "ready")]; } });
  const terminal = createTerminal({ paths, repos, adminPort: ADMIN_PORT, apiPort: 4317, spawn, fakeShell: false, env: { PATH: "/usr/bin", SHELL: "/bin/zsh", HUB_MAILER: "fake", HUB_DB: "/x.db", LANG: "C" }, nodeBin: "/n22/bin/node", tickets: ticketStore({ ttlMs: 30_000, ...(o.now ? { now: o.now } : {}) }), detector, ...(o.clock ? { now: o.clock } : {}) });
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

describe("always on (decision 0032): no switch", () => {
  it("with an empty config, or a leftover terminal key, every route answers", async () => {
    for (const cfg of [{}, { terminal: { enabled: false } }]) {
      config(cfg);
      spawned = [];
      const { call } = setup();
      const s = (await (await call("GET", "/api/terminal")).json()) as Record<string, unknown>;
      expect(s).toMatchObject({ unattended: false, presets: ["claude", "codex", "shell"], sessions: [], problem: null });
      expect(s).not.toHaveProperty("enabled");
      const made = await call("POST", "/api/terminal/sessions", { preset: "shell" });
      expect(made.status).toBe(201);
      const { id } = (await made.json()) as { id: string };
      expect((await call("POST", "/api/terminal/tickets", { session: id })).status).toBe(200);
      expect((await call("DELETE", `/api/terminal/sessions/${id}`)).status).toBe(200);
      expect(spawned).toHaveLength(1);
    }
  });
  it("an unknown upgrade path is still 404", async () => {
    config({});
    expect(await upgrade(setup().terminal, "/elsewhere", { origin: ADMIN.origin })).toBe(404);
  });
});

describe("P66: when no tab can start, the state says why and a start is 503 with the same fix", () => {
  const broken = { reason: "node-pty does not load on this Node (v99): ABI mismatch", fix: "pnpm --dir /core/app install --frozen-lockfile" };
  it("problem on the state; create and ensure refused without a spawn; the fix line is the readiness's", async () => {
    config({});
    let ready: typeof broken | null = broken;
    const terminal = createTerminal({ paths, repos, adminPort: ADMIN_PORT, apiPort: 4317, spawn, fakeShell: false, env: { SHELL: "/bin/zsh" }, readiness: () => ready, detector: cliDetector({ detect: async () => [fact("claude", "ready")] }) });
    const app = createApp(repos, { terminal, adminPort: ADMIN_PORT });
    const call = (method: string, p: string, body?: unknown) => app.request(`${API}${p}`, { method, headers: ADMIN, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    expect(terminal.warm()).toEqual(broken);
    expect(await (await call("GET", "/api/terminal")).json()).toMatchObject({ problem: broken, presets: ["claude", "codex", "shell"] });
    for (const [p, body] of [["/api/terminal/ensure", { project: "acme" }], ["/api/terminal/sessions", { preset: "shell" }]] as const) {
      const r = await call("POST", p, body);
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ error: `The terminal cannot start: ${broken.reason}.`, code: "terminal_unavailable", fix: broken.fix });
    }
    expect(spawned).toEqual([]);
    // Fixed (he ran the line): the recheck (Agent tools' Refresh) clears it and a tab starts.
    ready = null;
    expect(terminal.recheck()).toBeNull();
    expect(((await (await call("GET", "/api/terminal")).json()) as { problem: unknown }).problem).toBeNull();
    expect((await call("POST", "/api/terminal/ensure", { project: "acme" })).status).toBe(201);
  });
  it("a readiness that throws is a problem, never a crash", () => {
    config({});
    const terminal = createTerminal({ paths, repos, adminPort: ADMIN_PORT, apiPort: 4317, spawn, readiness: () => { throw new Error("boom"); } });
    expect(terminal.warm()).toEqual({ reason: "the terminal check failed: boom", fix: "hub doctor --only Agent" });
  });
});

describe("the doors", () => {
  beforeEach(() => config({ agent: { default: "codex", unattended: true } }));

  it("offers the presets from the server's table, default CLI first", async () => {
    const s = (await (await setup().call("GET", "/api/terminal")).json()) as { unattended: boolean; presets: string[]; sessions: unknown[] };
    expect(s).toMatchObject({ unattended: true, presets: ["codex", "claude", "shell"], sessions: [], problem: null });
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
  beforeEach(() => config({ agent: { default: "claude", unattended: false } }));
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
  it("a stale unknown is replaced by the next GET in the background, without a session ending (measured 2026-11-19 under launchd)", async () => {
    let t = 0;
    let answer: CliFact[] = [{ ...fact("claude", "unknown"), version: null }, { ...fact("codex", "unknown"), version: null }];
    const detector = cliDetector({ detect: async () => answer, now: () => t });
    const terminal = createTerminal({ paths, repos, adminPort: ADMIN_PORT, apiPort: 4317, spawn, fakeShell: false, env: { SHELL: "/bin/zsh" }, readiness: () => null, detector });
    await detector.get();
    answer = [fact("claude", "ready"), fact("codex", "ready")];
    expect(terminal.state().clis.map((c) => c.state)).toEqual(["unknown", "unknown"]); // fresh for 60 s: no new run
    t = 61_000;
    expect(terminal.state().clis.map((c) => c.state)).toEqual(["unknown", "unknown"]); // never waits: the last answer now
    await detector.get();
    expect(terminal.state().clis.map((c) => c.state)).toEqual(["ready", "ready"]);
  });
  it("a stale answer with a CLI missing is not re-detected by GET (the login shell would run every minute)", async () => {
    let t = 0;
    let runs = 0;
    const detector = cliDetector({ detect: async () => { runs++; return [fact("claude", "ready"), fact("codex", "missing")]; }, now: () => t });
    const terminal = createTerminal({ paths, repos, adminPort: ADMIN_PORT, apiPort: 4317, spawn, fakeShell: false, env: { SHELL: "/bin/zsh" }, readiness: () => null, detector });
    await detector.get();
    t = 61_000;
    terminal.state();
    terminal.state();
    await new Promise((r) => setTimeout(r, 10));
    expect(runs).toBe(1);
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

describe("P64: ensure resumes the project's last session; + always starts fresh", () => {
  const ID = "8d31964d-2edc-490c-91a8-dfb10ffb47de";
  const at = new Date("2026-11-19T06:03:02.000Z");
  const logSession = (o: { project?: string; cli?: "claude" | "codex"; transcript?: string } = {}) => {
    mkdirSync(paths.secrets, { recursive: true });
    const transcript = o.transcript ?? join(home, "claude-projects", `${ID}.jsonl`);
    mkdirSync(join(transcript, ".."), { recursive: true });
    writeFileSync(transcript, "{}\n");
    const env = { project: o.project ?? "acme", session: ID, cli: o.cli ?? ("claude" as const) };
    appendEvents(logStoreOf(paths), [
      { ...env, ts: "2026-11-19T06:02:48.000Z", kind: "session", data: { phase: "start", transcript } },
      { ...env, ts: at.toISOString(), kind: "prompt", data: { text: "о чем мы?" } },
    ], at);
  };
  const soon = () => new Date(at.getTime() + 3_600_000);
  beforeEach(() => config({}));

  it("after a restart the column resumes the logged Claude Code session: --resume <id> in the argv, 'resumed' in the title, the line says when", async () => {
    logSession();
    const { call } = setup({ clock: soon });
    const r = (await (await call("POST", "/api/terminal/ensure", { project: "acme" })).json()) as { session: { title: string }; why: string };
    expect(spawned[0]?.args.slice(-8)).toEqual(["/n22/bin/node", paths.hubBin, "agent", "acme", "--cli", "claude", "--resume", ID]);
    expect(r.session.title).toBe("acme · Claude Code · resumed");
    expect(r.why).toMatch(/^Resumed the Claude Code session of \d\d:\d\d \(8d31964d\)\. \+ starts a new one\.$/);
  });
  it("the + menu (POST /sessions) never resumes", async () => {
    logSession();
    const { call } = setup({ clock: soon });
    const r = (await (await call("POST", "/api/terminal/sessions", { preset: "claude", project: "acme" })).json()) as { title: string };
    expect(spawned[0]?.args).not.toContain("--resume");
    expect(r.title).toBe("acme · Claude Code");
  });
  it("older than 24 h, another project's session, or a transcript that is gone: a fresh start", async () => {
    logSession();
    const late = setup({ clock: () => new Date(at.getTime() + 25 * 3_600_000) });
    await late.call("POST", "/api/terminal/ensure", { project: "acme" });
    expect(spawned[0]?.args).not.toContain("--resume");
  });
  it("isolation: a session logged for another project is not resumed here", async () => {
    logSession({ project: "beta" });
    const { call } = setup({ clock: soon });
    await call("POST", "/api/terminal/ensure", { project: "acme" });
    expect(spawned[0]?.args).not.toContain("--resume");
  });
  it("Codex: a rollout written under other rules is not resumed (Codex keeps the instructions it started with)", async () => {
    const rollout = join(paths.codexHomes, "acme", "sessions", `rollout-${ID}.jsonl`);
    logSession({ cli: "codex", transcript: rollout });
    writeFileSync(rollout, JSON.stringify({ type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "OLD RULES" }] } }) + "\n");
    const { call } = setup({ clock: soon, facts: [fact("claude", "missing"), fact("codex", "ready")] });
    const r = (await (await call("POST", "/api/terminal/ensure", { project: "acme" })).json()) as { session: { preset: string; title: string }; why: string };
    expect(r.session.preset).toBe("codex");
    expect(spawned[0]?.args).not.toContain("--resume");
    expect(r.session.title).toBe("acme · Codex");
    expect(r.why).toBe(`Codex: Claude Code is not installed · fix claude · Not resumed: ${CODEX_RULES_CHANGED}. A fresh session.`);
  });
  it("Codex: a rollout with today's rules is resumed", async () => {
    const rollout = join(paths.codexHomes, "acme", "sessions", `rollout-${ID}.jsonl`);
    logSession({ cli: "codex", transcript: rollout });
    writeFileSync(rollout, JSON.stringify({ type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: sessionInstructions(paths.home, paths.projects, "acme") }] } }) + "\n");
    const { call } = setup({ clock: soon, facts: [fact("claude", "missing"), fact("codex", "ready")] });
    const r = (await (await call("POST", "/api/terminal/ensure", { project: "acme" })).json()) as { session: { title: string } };
    expect(spawned[0]?.args.slice(-2)).toEqual(["--resume", ID]);
    expect(r.session.title).toBe("acme · Codex · resumed");
  });
});
