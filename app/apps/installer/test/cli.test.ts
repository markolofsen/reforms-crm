import { execa } from "execa";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultRoot } from "../src/context";

// The real CLI in a child process: only `--help` and a failing parse, so nothing is changed on disk.
const bin = path.join(defaultRoot(), "app", "apps", "installer", "bin", "hub.mjs");
const hub = (...args: string[]) => execa("node", [bin, ...args], { reject: false, env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" }, timeout: 60000 });

describe("hub command set", () => {
  it("lists at most 5 commands in --help: agent, up, doctor, setup (and help)", async () => {
    const r = await hub("--help");
    expect(r.exitCode).toBe(0);
    const block = /Commands:\n([\s\S]*?)(\n\n|$)/.exec(r.stdout)?.[1] ?? "";
    const names = block.split("\n").map((l) => /^\s{2}(\S+)/.exec(l)?.[1]).filter(Boolean);
    expect(names.length).toBeLessThanOrEqual(5);
    for (const n of ["agent", "up", "doctor", "setup"]) expect(names, r.stdout).toContain(n);
  });
  it("has no `sync` command and no `--sync` option", async () => {
    expect((await hub("sync", "acme")).exitCode).not.toBe(0);
    const up = await hub("up", "--help");
    expect(up.stdout).not.toContain("--sync");
    expect((await hub("--help")).stdout).not.toMatch(/\bsync\b/i);
  });
  it("the archived `notify` command is gone (P25)", async () => {
    expect((await hub("notify", "tick")).exitCode).not.toBe(0);
  });
  it("doctor --only runs just the named step and prints its row with a time; an unknown id fails; --only with --fast is refused", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "hub-doctor-only-"));
    mkdirSync(path.join(home, "config"), { recursive: true });
    writeFileSync(path.join(home, "config", "config.json"), JSON.stringify({ account: "a", model: "sonnet" }));
    const run = (...a: string[]) => execa("node", [bin, ...a], { reject: false, env: { ...process.env, HUB_HOME: home, NO_COLOR: "1", FORCE_COLOR: "0" }, timeout: 60000 });
    const ok = await run("doctor", "--only", "files.config-keys");
    expect(ok.exitCode, ok.stderr).toBe(0);
    expect(ok.stdout).toMatch(/WARN\s+files\.config-keys\s+\d+\.\ds\s+config\.json has key\(s\) nothing reads: model/);
    expect(ok.stdout).not.toContain("backup.");
    expect((await run("doctor", "--only", "no.such.step")).exitCode).not.toBe(0);
    expect((await run("doctor", "--only", "files.config-keys", "--fast")).exitCode).not.toBe(0);
  });
  it("hidden commands still parse and have their own help", async () => {
    for (const name of ["link", "install", "projects", "guide", "docs", "token", "test", "uninstall", "audit-run"]) {
      const r = await hub(name, "--help");
      expect(r.exitCode, `${name}: ${r.stderr}`).toBe(0);
    }
  });
});
