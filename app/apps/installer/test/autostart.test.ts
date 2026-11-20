// P67 (decision 0033): the LaunchAgent step, `hub up --service`, `hub up` beside launchd, stop, restart, autostart, uninstall.
// launchd and sysctl are faked (`launchd()` below answers every verb); nothing here reaches the real launchctl.
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appendStart, readStarts, type StartLine } from "@hub/config/autostart";
import { describe, expect, it } from "vitest";
import { autostartPlist, currentNodeDir, filesOf, readPlist } from "../src/autostart";
import { autostartCommand, restartCommand, stopCommand, upViaLaunchd } from "../src/autostart-command";
import { runService, type ServiceDeps } from "../src/service";
import { autostartApply, autostartCheck } from "../src/steps/autostart";
import { STEPS } from "../src/steps/index";
import { install } from "../src/runner";
import { uninstall } from "../src/uninstall";
import { fake, type Call } from "./helpers";

const BOOT = Date.parse("2026-11-19T08:00:00Z");

/** A launchd for one test: which labels are loaded, running, disabled; every launchctl argv lands in `calls`. */
function launchd(o: { loaded?: boolean; running?: boolean; disabled?: boolean } = {}) {
  const st = { loaded: o.loaded ?? false, running: o.running ?? false, disabled: o.disabled ?? false, label: "" };
  const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
  const run = (c: Call) => {
    if (c.cmd === "/usr/sbin/sysctl") return ok(`{ sec = ${BOOT / 1000}, usec = 0 } Wed Nov 19 08:00:00 2026`);
    if (c.cmd !== "launchctl") return undefined;
    switch (c.args[0]) {
      case "print": return st.loaded ? ok(`\tstate = ${st.running ? "running" : "not running"}\n${st.running ? "\tpid = 777\n" : ""}`) : { code: 113, stdout: "", stderr: "" };
      case "print-disabled": return ok(st.disabled ? `"${st.label}" => disabled` : "");
      case "bootstrap": st.loaded = true; return ok();
      case "bootout": st.loaded = false; st.running = false; return ok();
      case "enable": st.disabled = false; return ok();
      case "disable": st.disabled = true; return ok();
      case "kickstart": st.running = true; return ok();
      case "kill": st.running = false; return ok();
      default: return { code: 1, stdout: "", stderr: "unknown verb" };
    }
  };
  return { st, run };
}

const setup = (o: Parameters<typeof launchd>[0] & { ports?: Record<string, unknown> } = {}) => {
  const l = launchd(o);
  const f = fake({ run: l.run });
  writeFileSync(f.ctx.paths.configFile, JSON.stringify(o.ports ?? { admin_port: 5180, api_port: 4380 }));
  l.st.label = filesOf(f.ctx).label;
  return { ...f, l, files: filesOf(f.ctx), launchctl: () => f.calls.filter((c) => c.cmd === "launchctl").map((c) => c.args) };
};

/** A node folder with `node` and `pnpm` in it. */
const nodeDir = (base: string) => {
  const d = path.join(base, "node-bin");
  mkdirSync(d, { recursive: true });
  for (const b of ["node", "pnpm"]) { writeFileSync(path.join(d, b), ""); chmodSync(path.join(d, b), 0o755); }
  return d;
};
const writeAgent = (s: ReturnType<typeof setup>, over: { home?: string; label?: string; node?: string } = {}) => {
  mkdirSync(path.dirname(s.files.plist), { recursive: true });
  writeFileSync(s.files.plist, autostartPlist({ label: over.label ?? s.files.label, home: over.home ?? s.ctx.paths.home, nodeDir: over.node ?? nodeDir(s.home), log: s.files.log }));
};
const started = (s: ReturnType<typeof setup>, at = BOOT + 60_000) => appendStart(s.files.starts, { at: new Date(at).toISOString(), event: "start" });

describe("autostartPlist", () => {
  it("is the exact plist for an instance", () => {
    expect(autostartPlist({ label: "com.reforms.hub.reforms-crm-saas", home: "/Users/o/crm/reforms-crm-saas", nodeDir: "/Users/o/.nvm/versions/node/v22.22.0/bin", log: "/Users/o/crm/reforms-crm-saas/state/autostart/launchd.log" })).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.reforms.hub.reforms-crm-saas</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>/Users/o/crm/reforms-crm-saas/run.sh</string><string>up</string><string>--service</string></array>
  <key>WorkingDirectory</key><string>/Users/o/crm/reforms-crm-saas</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HUB_AUTOSTART</key><string>1</string>
    <key>PATH</key><string>/Users/o/.nvm/versions/node/v22.22.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>LANG</key><string>en_US.UTF-8</string>
    <key>TURBO_DAEMON</key><string>false</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ExitTimeOut</key><integer>30</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>StandardOutPath</key><string>/Users/o/crm/reforms-crm-saas/state/autostart/launchd.log</string>
  <key>StandardErrorPath</key><string>/Users/o/crm/reforms-crm-saas/state/autostart/launchd.log</string>
</dict>
</plist>
`);
  });
  it("escapes a path with @, spaces and & and reads it back; PATH begins with the node folder", () => {
    const home = "/Users/o/workspace/@projects/a & b/hub one";
    const text = autostartPlist({ label: "com.reforms.hub.hub-one", home, nodeDir: "/n/bin", log: `${home}/state/autostart/launchd.log` });
    expect(text).toContain("a &amp; b");
    expect(readPlist(text)).toEqual({ label: "com.reforms.hub.hub-one", home, program: ["/bin/bash", `${home}/run.sh`, "up", "--service"], nodeDir: "/n/bin" });
  });
});

describe("autostart.agent check, in verdict 10's order", () => {
  it("is in the step list, not optional, in the Server group", () => {
    const s = STEPS.find((x) => x.id === "autostart.agent")!;
    expect(s.group).toBe("Server");
    expect(s.optional).toBeUndefined();
    expect(s.audit).toBeUndefined();
  });
  it("passes off macOS", async () => {
    expect((await autostartCheck(setup().ctx, "linux")).level).toBe("pass");
  });
  it("no plist: fails with the fix on explicit ports, warns on the default pair (a fresh instance is told to set ports first)", async () => {
    expect(await autostartCheck(setup().ctx, "darwin")).toMatchObject({ level: "fail", detail: expect.stringContaining("./run.sh install --only autostart.agent") });
    const d = await autostartCheck(setup({ ports: {} }).ctx, "darwin");
    expect(d).toMatchObject({ level: "warn", detail: expect.stringContaining("admin_port") });
  });
  it("fails on a plist that does not parse, another label, another instance, a missing node", async () => {
    const s = setup({ loaded: true });
    mkdirSync(path.dirname(s.files.plist), { recursive: true });
    writeFileSync(s.files.plist, "not a plist");
    expect((await autostartCheck(s.ctx, "darwin")).detail).toContain("does not parse");
    writeAgent(s, { label: "com.reforms.hub.other" });
    expect((await autostartCheck(s.ctx, "darwin")).detail).toContain("label");
    writeAgent(s, { home: "/somewhere/else" });
    expect((await autostartCheck(s.ctx, "darwin")).detail).toContain("moved?");
    writeAgent(s, { node: path.join(s.home, "gone") });
    expect((await autostartCheck(s.ctx, "darwin")).detail).toContain("no node in");
  });
  it("fails for an instance under ~/Desktop", async () => {
    const s = setup();
    const desk = path.join(s.home, "Desktop", "inst");
    mkdirSync(path.join(desk, "config"), { recursive: true });
    writeFileSync(path.join(desk, "config", "config.json"), JSON.stringify({ admin_port: 5180, api_port: 4380 }));
    const f = fake({ run: s.l.run });
    const ctx = { ...f.ctx, home: s.home, paths: { ...f.ctx.paths, home: desk, autostart: path.join(desk, "state", "autostart"), configFile: path.join(desk, "config", "config.json") } };
    mkdirSync(path.dirname(filesOf(ctx).plist), { recursive: true });
    writeFileSync(filesOf(ctx).plist, autostartPlist({ label: filesOf(ctx).label, home: desk, nodeDir: nodeDir(s.home), log: "/l" }));
    expect((await autostartCheck(ctx, "darwin")).detail).toContain("~/Desktop");
  });
  it("fails for an autostarted instance on the default pair, and for two agents on one port pair", async () => {
    const d = setup({ ports: { admin_port: 5173, api_port: 4317 } });
    writeAgent(d);
    expect((await autostartCheck(d.ctx, "darwin")).detail).toContain("5173/4317");
    const s = setup({ loaded: true });
    writeAgent(s);
    const twin = path.join(s.home, "twin");
    mkdirSync(path.join(twin, "config"), { recursive: true });
    writeFileSync(path.join(twin, "config", "config.json"), JSON.stringify({ admin_port: 5180, api_port: 4381 }));
    writeFileSync(path.join(path.dirname(s.files.plist), "com.reforms.hub.twin.plist"), autostartPlist({ label: "com.reforms.hub.twin", home: twin, nodeDir: nodeDir(s.home), log: "/l" }));
    expect((await autostartCheck(s.ctx, "darwin")).detail).toContain("same port");
  });
  it("warns when switched off (launchd or the off file), fails when not loaded", async () => {
    const off = setup({ loaded: true, disabled: true });
    writeAgent(off);
    expect(await autostartCheck(off.ctx, "darwin")).toMatchObject({ level: "warn", detail: expect.stringContaining("off") });
    const file = setup({ loaded: true });
    writeAgent(file);
    mkdirSync(file.files.dir, { recursive: true });
    writeFileSync(file.files.off, "");
    expect((await autostartCheck(file.ctx, "darwin")).level).toBe("warn");
    const unloaded = setup();
    writeAgent(unloaded);
    expect((await autostartCheck(unloaded.ctx, "darwin")).detail).toContain("not loaded");
  });
  it("fails on a tripped guard, warns when the last start is older than the boot, passes after a start since the boot", async () => {
    const s = setup({ loaded: true, running: true });
    writeAgent(s);
    appendStart(s.files.starts, { at: new Date(BOOT - 3600_000).toISOString(), event: "start" });
    expect(await autostartCheck(s.ctx, "darwin")).toMatchObject({ level: "warn", detail: expect.stringContaining("Login Items") });
    started(s);
    expect(await autostartCheck(s.ctx, "darwin")).toMatchObject({ level: "pass", detail: expect.stringContaining("pid 777") });
    appendStart(s.files.starts, { at: new Date(BOOT + 120_000).toISOString(), event: "guard", detail: "next build: ENOSPC" });
    expect(await autostartCheck(s.ctx, "darwin")).toMatchObject({ level: "fail", detail: expect.stringContaining("ENOSPC") });
  });
  it("warns on a log over 10 MB", async () => {
    const s = setup({ loaded: true });
    writeAgent(s);
    started(s);
    writeFileSync(s.files.log, Buffer.alloc(11 * 1024 * 1024));
    expect(await autostartCheck(s.ctx, "darwin")).toMatchObject({ level: "warn", detail: expect.stringContaining("MB") });
  });
});

describe("autostart.agent apply", () => {
  it("writes the plist 0644 and state/autostart/, then bootstraps", async () => {
    const s = setup();
    const did = await autostartApply(s.ctx);
    expect(statSync(s.files.plist).mode & 0o777).toBe(0o644);
    expect(existsSync(s.files.dir)).toBe(true);
    expect(readPlist(readFileSync(s.files.plist, "utf8"))?.nodeDir).toBe(currentNodeDir());
    expect(s.launchctl()).toContainEqual(["bootstrap", "gui/501", s.files.plist]);
    expect(did).toContain("loaded");
  });
  it("leaves a running agent running: no bootout", async () => {
    const s = setup({ loaded: true, running: true });
    expect(await autostartApply(s.ctx)).toContain("next login");
    expect(s.launchctl().some((a) => a[0] === "bootout" || a[0] === "bootstrap")).toBe(false);
  });
  it("refuses the default ports and never edits the config", async () => {
    const s = setup({ ports: {} });
    await expect(autostartApply(s.ctx)).rejects.toThrow(/admin_port/);
    expect(readFileSync(s.ctx.paths.configFile, "utf8")).toBe("{}");
  });
  it("a dry run writes nothing", async () => {
    const l = launchd();
    const f = fake({ run: l.run, dryRun: true });
    writeFileSync(f.ctx.paths.configFile, JSON.stringify({ admin_port: 5180, api_port: 4380 }));
    const [r] = await install(f.ctx, STEPS.filter((s) => s.id === "autostart.agent"));
    expect(r!.outcome).toBe("skipped");
    expect(existsSync(filesOf(f.ctx).plist)).toBe(false);
  });
});

// ---- hub up --service ----

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  signals: string[] = [];
  kill(sig: string) { this.signals.push(sig); return true; }
}
const svc = (s: ReturnType<typeof setup>, over: Partial<ServiceDeps> & { busy?: number[]; now?: () => number } = {}) => {
  const child = new FakeChild();
  let handler: ((sig: NodeJS.Signals) => void) | undefined;
  let spawned = 0;
  const deps: ServiceDeps = {
    start: () => { spawned++; return child as unknown as ChildProcess; },
    portBusy: async (p) => (over.busy ?? []).includes(p),
    healthy: async () => false,
    bootAt: async () => BOOT,
    now: over.now ?? (() => BOOT + 3600_000),
    out: () => {},
    onSignal: (h) => { handler = h; return () => { handler = undefined; }; },
    signalGroup: (sig, c) => (c as unknown as FakeChild).kill(sig),
    readyEveryMs: 5,
    ...over,
  };
  const run = () => runService({ files: s.files, ports: { admin: 5180, api: 4380 }, env: {} }, deps);
  return { child, run, signal: (sig: NodeJS.Signals) => handler?.(sig), spawned: () => spawned };
};
/** The service awaits its checks before it spawns: emit on the child only once it exists. */
const spawnedOf = async (v: { spawned: () => number }) => { while (v.spawned() === 0) await new Promise((r) => setTimeout(r, 2)); };
const events = (s: ReturnType<typeof setup>) => readStarts(s.files.starts).map((l) => l.event);

describe("hub up --service", () => {
  it("every variable it hands the server survives `turbo run start` (strict env: an unlisted one arrives unset)", () => {
    // Measured 2026-11-19 on v0.12.12: HUB_AUTOSTART=1 was set on `pnpm start` but missing from globalPassThroughEnv, so the
    // server under launchd answered startedBy "hand".
    const turbo = JSON.parse(readFileSync(path.resolve(__dirname, "..", "..", "..", "turbo.json"), "utf8")) as { globalPassThroughEnv: string[] };
    const src = readFileSync(path.resolve(__dirname, "..", "src", "service.ts"), "utf8");
    const handed = [...(src.match(/deps\.start\(\{.*\}\);/)?.[0] ?? "").matchAll(/\b(HUB_[A-Z_]+):/g)].map((m) => m[1]);
    expect(handed).toEqual(["HUB_AUTOSTART", "HUB_ADMIN_PORT", "HUB_PORT"]);
    expect(turbo.globalPassThroughEnv).toEqual(expect.arrayContaining(handed));
  });
  it("exits 0 without starting when a hand-run holds the ports", async () => {
    const s = setup();
    const v = svc(s, { busy: [4380] });
    expect(await v.run()).toBe(0);
    expect(v.spawned()).toBe(0);
    expect(events(s)).toEqual(["standby"]);
  });
  it("exits 0 without starting while the off file is there", async () => {
    const s = setup();
    mkdirSync(s.files.dir, { recursive: true });
    writeFileSync(s.files.off, "");
    const v = svc(s);
    expect(await v.run()).toBe(0);
    expect(v.spawned()).toBe(0);
  });
  it("forwards SIGTERM to the server and exits 0 whatever the server answered", async () => {
    const s = setup();
    const v = svc(s);
    const done = v.run();
    await spawnedOf(v);
    v.signal("SIGTERM");
    v.signal("SIGTERM"); // our own group signal coming back: forwarded once
    expect(v.child.signals).toEqual(["SIGTERM"]);
    v.child.emit("exit", null, "SIGTERM");
    expect(await done).toBe(0);
    expect(readStarts(s.files.starts).at(-1)).toMatchObject({ event: "exit", code: 0, detail: "stopped by SIGTERM" });
  });
  it("a crash is non-zero (launchd restarts it) with the last error line", async () => {
    const s = setup();
    const v = svc(s);
    const done = v.run();
    await spawnedOf(v);
    v.child.stderr.emit("data", Buffer.from("Error: ENOSPC: no space left on device\n"));
    v.child.emit("exit", 1, null);
    expect(await done).toBe(1);
    expect(readStarts(s.files.starts).at(-1)).toMatchObject({ event: "exit", code: 1, detail: "Error: ENOSPC: no space left on device" });
  });
  const failAt = (s: ReturnType<typeof setup>, ms: number) => appendStart(s.files.starts, { at: new Date(ms).toISOString(), event: "exit", code: 1, detail: "x" } satisfies StartLine);
  it("trips the guard on the 5th failure within 15 minutes, then stands still until a reset", async () => {
    const s = setup();
    const now = BOOT + 3600_000;
    for (let i = 4; i >= 1; i--) failAt(s, now - i * 60_000);
    const v = svc(s, { now: () => now });
    const done = v.run();
    await spawnedOf(v);
    v.child.emit("exit", 1, null);
    expect(await done).toBe(0);
    expect(events(s).at(-1)).toBe("guard");
    const again = svc(s, { now: () => now + 1000 });
    expect(await again.run()).toBe(0);
    expect(again.spawned()).toBe(0);
  });
  it("does not trip on five failures spread over an hour", async () => {
    const s = setup();
    const now = BOOT + 3 * 3600_000;
    for (let i = 4; i >= 1; i--) failAt(s, now - i * 16 * 60_000);
    const v = svc(s, { now: () => now });
    const done = v.run();
    await spawnedOf(v);
    v.child.emit("exit", 1, null);
    expect(await done).toBe(1);
    expect(events(s)).not.toContain("guard");
  });
});

// ---- hub up by hand, stop, restart, autostart ----

const cmd = (over: { healthy?: boolean; busy?: boolean } = {}) => {
  const opened: string[] = [];
  const out: string[] = [];
  return { opened, out, deps: { platform: "darwin" as const, healthy: async () => over.healthy ?? true, portBusy: async () => over.busy ?? false, open: async (u: string) => { opened.push(u); }, out: (l: string) => out.push(l), sleep: async () => {} } };
};

describe("hub up beside launchd", () => {
  it("launchd runs it: says so, opens the admin once, starts nothing", async () => {
    const s = setup({ loaded: true, running: true });
    writeAgent(s);
    const c = cmd();
    expect(await upViaLaunchd(s.ctx, c.deps)).toBe(0);
    expect(c.opened).toEqual(["http://127.0.0.1:5180"]);
    expect(c.out.join("\n")).toContain("started at login by launchd");
    expect(s.launchctl().some((a) => a[0] === "kickstart")).toBe(false);
  });
  it("loaded and stopped: kickstart, then the health wait", async () => {
    const s = setup({ loaded: true });
    writeAgent(s);
    const c = cmd();
    expect(await upViaLaunchd(s.ctx, c.deps)).toBe(0);
    expect(s.launchctl()).toContainEqual(["kickstart", `gui/501/${s.files.label}`]);
    expect(events(s)).toContain("reset");
  });
  it("off or not set up: null, so the foreground run goes on as before", async () => {
    const off = setup({ loaded: true, running: true, disabled: true });
    writeAgent(off);
    expect(await upViaLaunchd(off.ctx, cmd().deps)).toBeNull();
    expect(await upViaLaunchd(setup().ctx, cmd().deps)).toBeNull();
    expect(await upViaLaunchd(off.ctx, { ...cmd().deps, platform: "linux" })).toBeNull();
    const standing = setup({ loaded: true });
    writeAgent(standing);
    expect(await upViaLaunchd(standing.ctx, cmd({ busy: true }).deps)).toBeNull(); // a hand-run holds the ports: "port in use", no kickstart
    expect(standing.launchctl().some((a) => a[0] === "kickstart")).toBe(false);
  });
  it("hub stop sends SIGTERM to the job; a hand-run is told to use Ctrl-C", async () => {
    const s = setup({ loaded: true, running: true });
    writeAgent(s);
    expect(await stopCommand(s.ctx, cmd().deps)).toBe(0);
    expect(s.launchctl()).toContainEqual(["kill", "SIGTERM", `gui/501/${s.files.label}`]);
    const hand = setup();
    const c = cmd({ busy: true });
    expect(await stopCommand(hand.ctx, c.deps)).toBe(1);
    expect(c.out.join("")).toContain("Ctrl-C");
  });
  it("hub restart is kickstart -k and clears the guard", async () => {
    const s = setup({ loaded: true, running: true });
    writeAgent(s);
    expect(await restartCommand(s.ctx, cmd().deps)).toBe(0);
    expect(s.launchctl()).toContainEqual(["kickstart", "-k", `gui/501/${s.files.label}`]);
    expect(events(s)).toContain("reset");
  });
  it("hub autostart off is disable plus the off file; on enables; status says it", async () => {
    const s = setup({ loaded: true, running: true });
    writeAgent(s);
    const c = cmd();
    expect(await autostartCommand(s.ctx, "off", c.deps)).toBe(0);
    expect(s.launchctl()).toContainEqual(["disable", `gui/501/${s.files.label}`]);
    expect(existsSync(s.files.off)).toBe(true);
    expect(s.launchctl().some((a) => ["bootout", "kill"].includes(a[0]!))).toBe(false);
    await autostartCommand(s.ctx, "status", c.deps);
    expect(c.out.at(-1)).toContain("Off");
    expect(await autostartCommand(s.ctx, "on", c.deps)).toBe(0);
    expect(existsSync(s.files.off)).toBe(false);
    expect(await autostartCommand(s.ctx, "on", { ...c.deps, platform: "linux" })).toBe(2);
  });
});

describe("hub uninstall", () => {
  it("boots the agent out and removes the plist, saying it stops the server; a dry run only says it", async () => {
    const dry = setup({ loaded: true, running: true });
    writeAgent(dry);
    const lines = await uninstall({ ...dry.ctx, dryRun: true });
    expect(lines.join("\n")).toContain("would boot out the LaunchAgent");
    expect(lines.join("\n")).toContain("stops the server");
    expect(existsSync(dry.files.plist)).toBe(true);
    const s = setup({ loaded: true, running: true });
    writeAgent(s);
    await uninstall(s.ctx);
    expect(s.launchctl()).toContainEqual(["bootout", `gui/501/${s.files.label}`]);
    expect(existsSync(s.files.plist)).toBe(false);
  });
});
