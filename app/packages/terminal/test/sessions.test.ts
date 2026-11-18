import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ServerFrame } from "@hub/contract/terminal";
import { nodePty, presetArgv, presetOrder, sessionManager, spawnLine, terminalEnv, type PtyProcess, type PtySpawn, type SpawnSpec, type Viewer } from "../src/index";

/** A PTY that records what it is told and lets the test speak for the program. */
function fakePty() {
  const made: Array<{ file: string; args: string[]; cols: number; rows: number; written: string[]; signals: string[]; paused: number; resumed: number; data: (d: string) => void; exit: (code: number) => void; size: [number, number] }> = [];
  const spawn: PtySpawn = (file, args, o) => {
    let onData: (d: string) => void = () => {};
    let onExit: (e: { exitCode: number | null }) => void = () => {};
    const rec = { file, args, cols: o.cols, rows: o.rows, written: [] as string[], signals: [] as string[], paused: 0, resumed: 0, data: (d: string) => onData(d), exit: (c: number) => onExit({ exitCode: c }), size: [o.cols, o.rows] as [number, number] };
    made.push(rec);
    const p: PtyProcess = {
      pid: 4242,
      onData: (cb) => { onData = cb; },
      onExit: (cb) => { onExit = cb; },
      write: (d) => rec.written.push(d),
      resize: (c, r) => { rec.size = [c, r]; },
      kill: (s) => rec.signals.push(s),
      pause: () => rec.paused++,
      resume: () => rec.resumed++,
    };
    return p;
  };
  return { spawn, made };
}

function viewer(buffered = () => 0) {
  const text: ServerFrame[] = [];
  const bin: string[] = [];
  const closed: number[] = [];
  const v: Viewer = { sendText: (f) => text.push(f), sendBinary: (d) => bin.push(d.toString("utf8")), bufferedAmount: buffered, close: (c) => closed.push(c) };
  return { v, text, bin, closed };
}

const spec = (over: Partial<SpawnSpec> = {}): SpawnSpec => ({ preset: "claude", project: "acme", title: "acme · Claude Code", file: "/bin/zsh", args: ["-l", "-i"], cwd: "/inst", env: {}, ...over });
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe("presets and env (S7)", () => {
  it("claude and codex run the core launcher as argv, exec'd by the login shell; shell is the login shell; no project means only shell", () => {
    const argv = presetArgv("claude", "acme", { nodeBin: "/n/node", hubBin: "/c/hub.mjs" });
    expect(argv).toEqual(["/n/node", "/c/hub.mjs", "agent", "acme", "--cli", "claude"]);
    expect(presetArgv("codex", "acme", { nodeBin: "/n/node", hubBin: "/c/hub.mjs" })?.slice(-2)).toEqual(["--cli", "codex"]);
    expect(spawnLine("/bin/zsh", argv)).toEqual({ file: "/bin/zsh", args: ["-l", "-i", "-c", 'exec "$0" "$@"', "/n/node", "/c/hub.mjs", "agent", "acme", "--cli", "claude"] });
    expect(spawnLine("/bin/zsh", null)).toEqual({ file: "/bin/zsh", args: ["-l", "-i"] });
    expect(presetArgv("shell", null, { nodeBin: "/n", hubBin: "/h" })).toBeNull();
    expect(() => presetArgv("claude", null, { nodeBin: "/n", hubBin: "/h" })).toThrow(/needs a project/);
    expect(presetOrder("claude", true)).toEqual(["claude", "codex", "shell"]);
    expect(presetOrder("codex", true)).toEqual(["codex", "claude", "shell"]);
    expect(presetOrder("codex", false)).toEqual(["shell"]);
  });
  it("the env names the instance and the project, puts the server's Node first, and drops the server-only variables", () => {
    const e = terminalEnv({ base: { PATH: "/usr/bin", HUB_MAILER: "fake", HUB_DB: "/x.db", HUB_PORT: "4317", NODE_OPTIONS: "--x", HUB_PROJECT: "old", LANG: "C" }, home: "/inst", project: "acme", nodeBin: "/n22/bin/node" });
    expect(e).toMatchObject({ HUB_HOME: "/inst", HUB_PROJECT: "acme", TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "hub", LANG: "en_US.UTF-8", PATH: "/n22/bin:/usr/bin" });
    for (const k of ["HUB_MAILER", "HUB_DB", "HUB_PORT", "NODE_OPTIONS"]) expect(e[k], k).toBeUndefined();
    expect(terminalEnv({ base: { HUB_PROJECT: "old" }, home: "/i", project: null, nodeBin: "/n/node" }).HUB_PROJECT).toBeUndefined();
    // The theme reaches a CLI that reads COLORFGBG (Claude Code, Codex pick their palette); none given, none inherited.
    expect(terminalEnv({ base: {}, home: "/i", project: null, nodeBin: "/n/node", theme: "dark" }).COLORFGBG).toBe("15;0");
    expect(terminalEnv({ base: {}, home: "/i", project: null, nodeBin: "/n/node", theme: "light" }).COLORFGBG).toBe("0;15");
    expect(terminalEnv({ base: { COLORFGBG: "15;0" }, home: "/i", project: null, nodeBin: "/n/node" }).COLORFGBG).toBeUndefined();
  });
});

describe("sessions", () => {
  it("writes nothing into the PTY of its own: keys typed before the program's first output reach it as typed, and the argv is the spawn's", () => {
    const f = fakePty();
    const m = sessionManager({ spawn: f.spawn });
    const s = m.create(spec({ args: ["-l", "-i", "-c", 'exec "$0" "$@"', "/n/node", "/c/hub.mjs", "agent", "acme", "--cli", "claude"] }));
    m.input(s.id, "д");
    f.made[0]!.data("% ");
    f.made[0]!.data("more");
    expect(f.made[0]!.written).toEqual(["д"]);
    expect(f.made[0]!.args.slice(-6)).toEqual(["/n/node", "/c/hub.mjs", "agent", "acme", "--cli", "claude"]);
  });
  it("attach sends ready, then a snapshot of the screen so far, then the live stream; input and resize reach the PTY, clamped", async () => {
    const f = fakePty();
    const m = sessionManager({ spawn: f.spawn, batchMs: 5 });
    const s = m.create(spec(), { cols: 9999, rows: 1 });
    expect([f.made[0]!.cols, f.made[0]!.rows]).toEqual([500, 2]);
    f.made[0]!.data("earlier output\r\n");
    const w = viewer();
    const off = await m.attach(s.id, w.v);
    expect(w.text[0]).toEqual({ op: "ready", session: s.id });
    expect(w.bin[0]).toContain("earlier output");
    f.made[0]!.data("live");
    await tick();
    expect(w.bin.at(-1)).toBe("live");
    m.input(s.id, "ls\r");
    expect(f.made[0]!.written).toContain("ls\r");
    m.resize(s.id, 1, 100000);
    expect(f.made[0]!.size).toEqual([2, 500]);
    off?.();
    expect(await m.attach("nope", viewer().v)).toBeNull();
  });
  it("one viewer: a second attach takes it and the first is told", async () => {
    const f = fakePty();
    const m = sessionManager({ spawn: f.spawn });
    const s = m.create(spec());
    const a = viewer();
    const b = viewer();
    await m.attach(s.id, a.v);
    await m.attach(s.id, b.v);
    expect(a.text).toContainEqual({ op: "taken" });
    expect(a.closed).toEqual([4409]);
  });
  it("pauses the PTY while the socket holds over 1 MB and resumes under 256 KB", async () => {
    const f = fakePty();
    let queued = 2_000_000;
    const m = sessionManager({ spawn: f.spawn, batchMs: 2 });
    const s = m.create(spec());
    await m.attach(s.id, viewer(() => queued).v);
    f.made[0]!.data("x".repeat(10));
    await tick(10);
    expect(f.made[0]!.paused).toBe(1);
    queued = 100;
    await tick(10);
    expect(f.made[0]!.resumed).toBe(1);
  });
  it("an exit is kept for the tab; closing sends SIGHUP then SIGKILL; at most 8 run", async () => {
    vi.useFakeTimers();
    const f = fakePty();
    const m = sessionManager({ spawn: f.spawn, killGraceMs: 3000 });
    const done = m.create(spec());
    f.made[0]!.exit(3);
    expect(m.list().find((x) => x.id === done.id)).toMatchObject({ state: "exited", exitCode: 3 });
    const live = m.create(spec());
    expect(m.kill(live.id)).toBe(true);
    expect(f.made[1]!.signals).toEqual(["SIGHUP"]);
    vi.advanceTimersByTime(3001);
    expect(f.made[1]!.signals).toEqual(["SIGHUP", "SIGKILL"]);
    expect(m.list().map((x) => x.id)).toEqual([done.id]);
    for (let i = 0; i < 8; i++) m.create(spec());
    expect(() => m.create(spec())).toThrow(/at most 8/);
    vi.useRealTimers();
  });
});

describe("the real PTY", () => {
  it("an agent's argv reaches the program untouched by the shell, even with input already waiting", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "hub-term-argv-"));
    let out = "";
    const m = sessionManager({ spawn: nodePty(), batchMs: 5 });
    const line = spawnLine("/bin/zsh", ["/bin/echo", "a  b", "$HOME;x", "'q'"]);
    const s = m.create(spec({ ...line, cwd: home, env: { PATH: "/usr/bin:/bin", HOME: home, ZDOTDIR: home, TERM: "xterm-256color" } }));
    m.input(s.id, "д");
    await m.attach(s.id, { sendText: () => {}, sendBinary: (d) => (out += d.toString("utf8")), bufferedAmount: () => 0, close: () => {} });
    await tick(1500);
    expect(out).toContain("a  b $HOME;x 'q'");
    m.killAll();
  });
  it("closing a tab kills the process group: the shell's child is gone", async () => {
    const m = sessionManager({ spawn: nodePty(), killGraceMs: 500 });
    const s = m.create(spec({ file: "/bin/sh", args: ["-c", "sleep 4242 & wait"], cwd: process.cwd(), env: { PATH: "/usr/bin:/bin" } }));
    await tick(500);
    const running = () => { try { return execFileSync("pgrep", ["-f", "sleep 4242"]).toString().trim() !== ""; } catch { return false; } };
    expect(running()).toBe(true);
    m.kill(s.id);
    await tick(1200);
    expect(running()).toBe(false);
  });
});
