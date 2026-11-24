import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendStart, autostartFiles, autostartLabel, failuresSince, GUARD, guardOf, lastStartOf, parseBootTime, parseDisabled, parsePrint, readStarts, rotateLog, switchAutostart, type LaunchctlRun, type StartLine } from "../src/autostart";
import { hubPaths } from "../src/paths";

const instance = (name = "hub-saas") => {
  const base = mkdtempSync(join(tmpdir(), "hub-autostart-"));
  const home = join(base, name);
  mkdirSync(home);
  return { base, paths: hubPaths({ home, env: {} }) };
};
const at = (ms: number) => new Date(ms).toISOString();
const T0 = Date.parse("2026-11-19T09:00:00Z");

describe("the label and the files come from the instance", () => {
  it("is com.reforms.hub.<folder name>; odd characters become -", () => {
    expect(autostartLabel({ home: "/x/hub-saas" })).toBe("com.reforms.hub.hub-saas");
    expect(autostartLabel({ home: "/x/my hub@2" })).toBe("com.reforms.hub.my-hub-2");
  });
  it("puts the plist in the agents folder and the rest in state/autostart", () => {
    const { paths } = instance();
    const f = autostartFiles(paths, "/u/Library/LaunchAgents");
    expect(f.plist).toBe("/u/Library/LaunchAgents/com.reforms.hub.hub-saas.plist");
    expect(f.log).toBe(join(paths.state, "autostart", "launchd.log"));
    expect(f.off).toBe(join(paths.state, "autostart", "off"));
  });
});

describe("the start guard", () => {
  const exit = (ms: number, code = 1): StartLine => ({ at: at(ms), event: "exit", code, detail: "boom" });
  it("counts five failed starts within 15 minutes, not five spread over an hour", () => {
    const close = [0, 1, 2, 3, 4].map((i) => exit(T0 + i * 60_000));
    expect(failuresSince(close, T0 + 5 * 60_000)).toHaveLength(GUARD.failures);
    const spread = [0, 1, 2, 3, 4].map((i) => exit(T0 + i * 15 * 60_000));
    expect(failuresSince(spread, T0 + 4 * 15 * 60_000).length).toBeLessThan(GUARD.failures);
  });
  it("forgets what came before the boot and before a reset; a clean exit is no failure", () => {
    const lines = [exit(T0), exit(T0 + 1000, 0), { at: at(T0 + 2000), event: "reset" as const }, exit(T0 + 3000)];
    expect(failuresSince(lines, T0 + 4000)).toHaveLength(1);
    expect(failuresSince(lines, T0 + 4000, T0 + 3500)).toHaveLength(0);
    const tripped = [{ at: at(T0), event: "guard" as const, detail: "next build failed" }];
    expect(guardOf(tripped)).toEqual({ at: at(T0), error: "next build failed" });
    expect(guardOf(tripped, T0 + 1)).toBeNull();
    expect(guardOf([...tripped, { at: at(T0 + 5), event: "reset" }])).toBeNull();
  });
  it("keeps the last 200 lines and skips a torn one", () => {
    const { paths } = instance();
    const f = autostartFiles(paths, "/u");
    for (let i = 0; i < 205; i++) appendStart(f.starts, { at: at(T0 + i), event: "start" }, 200);
    writeFileSync(f.starts, `${readFileSync(f.starts, "utf8")}{"at":`);
    const lines = readStarts(f.starts);
    expect(lines).toHaveLength(200);
    expect(lastStartOf(lines)?.at).toBe(at(T0 + 204));
  });
});

describe("what launchctl and sysctl print", () => {
  it("reads loaded, running and the pid from print; a missing job is not loaded", () => {
    expect(parsePrint(0, "gui/501/x = {\n\tstate = running\n\tpid = 4242\n")).toEqual({ loaded: true, running: true, pid: 4242 });
    expect(parsePrint(0, "\tstate = not running\n")).toEqual({ loaded: true, running: false });
    expect(parsePrint(113, "")).toEqual({ loaded: false, running: false });
  });
  it("reads disabled from print-disabled; a label not listed is enabled (S0)", () => {
    const out = 'disabled services = {\n\t\t"com.reforms.hub.a" => disabled\n\t\t"com.reforms.hub.b" => enabled\n}';
    expect(parseDisabled(out, "com.reforms.hub.a")).toBe(true);
    expect(parseDisabled(out, "com.reforms.hub.b")).toBe(false);
    expect(parseDisabled(out, "com.reforms.hub.c")).toBe(false);
  });
  it("reads the boot time", () => {
    expect(parseBootTime("{ sec = 1763540000, usec = 12 } Wed Nov 19 09:00:00 2026")).toBe(1763540000000);
    expect(parseBootTime("")).toBeUndefined();
  });
});

describe("the log is bounded", () => {
  it("copies to .1 and truncates in place over the cap (launchd keeps the file open)", () => {
    const { paths } = instance();
    const f = autostartFiles(paths, "/u");
    mkdirSync(f.dir, { recursive: true });
    writeFileSync(f.log, "x".repeat(100));
    expect(rotateLog(f.log, 50)).toBe(true);
    expect(statSync(f.log).size).toBe(0);
    expect(statSync(`${f.log}.1`).size).toBe(100);
    expect(rotateLog(f.log, 50)).toBe(false);
  });
});

describe("the switch", () => {
  const runner = (loaded: boolean) => {
    const calls: string[][] = [];
    const run: LaunchctlRun = async (args) => {
      calls.push(args);
      return args[0] === "print" ? { code: loaded ? 0 : 113, stdout: "", stderr: "" } : { code: 0, stdout: "", stderr: "" };
    };
    return { calls, run };
  };
  const setUp = () => {
    const { base, paths } = instance();
    const f = autostartFiles(paths, join(base, "agents"));
    mkdirSync(join(base, "agents"));
    writeFileSync(f.plist, "<plist/>");
    return f;
  };
  it("off is disable and the off file, never bootout or kill", async () => {
    const f = setUp();
    const r = runner(true);
    expect(await switchAutostart(r.run, f, 501, false)).toEqual([["disable", `gui/501/${f.label}`]]);
    expect(r.calls.some((c) => ["bootout", "kill", "kickstart"].includes(c[0] ?? ""))).toBe(false);
    expect(existsSync(f.off)).toBe(true);
  });
  it("on is enable, removes the off file, and bootstraps only when not loaded", async () => {
    const f = setUp();
    await switchAutostart(runner(true).run, f, 501, false);
    expect(await switchAutostart(runner(true).run, f, 501, true)).toEqual([["enable", `gui/501/${f.label}`]]);
    expect(existsSync(f.off)).toBe(false);
    expect(await switchAutostart(runner(false).run, f, 501, true)).toEqual([["enable", `gui/501/${f.label}`], ["bootstrap", "gui/501", f.plist]]);
  });
  it("refuses without a plist", async () => {
    const { paths } = instance();
    await expect(switchAutostart(runner(true).run, autostartFiles(paths, "/nowhere"), 501, true)).rejects.toThrow(/not set up/);
  });
});
