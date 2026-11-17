import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { doctor, exitCode, install, slowest, table } from "../src/runner.ts";
import { fileSteps } from "../src/steps/files.ts";
import { projectSteps } from "../src/steps/projects.ts";
import { runtimeSkills, skillSteps } from "../src/steps/skills.ts";
import { uninstall } from "../src/uninstall.ts";
import { fake } from "./helpers.ts";

const steps = [...fileSteps, ...skillSteps.filter((s) => s.id === "skills.runtime"), ...projectSteps];
const snapshot = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : out.push(`${p}:${statSync(p).size}`); } };
  walk(dir);
  return out.sort();
};

describe("install is idempotent and never overwrites", () => {
  it("first run changes, second run is all ok, config edits survive", async () => {
    const f = fake();
    // a project; the run-time skills are the core's own
    mkdirSync(path.join(f.root, "projects", "alpha"), { recursive: true });
    writeFileSync(path.join(f.root, "projects", "alpha", "project.md"), "# Alpha\n");
    const skill = runtimeSkills(f.ctx)[0]!;

    const r1 = await install(f.ctx, steps);
    expect(r1.filter((r) => r.outcome === "failed"), JSON.stringify(r1.filter((r) => r.outcome === "failed").map((r) => [r.step.id, r.detail]))).toEqual([]);
    expect(r1.find((r) => r.step.id === "files.config")!.outcome).toBe("changed");
    expect(statSync(f.ctx.configDir).mode & 0o777).toBe(0o700);
    expect(lstatSync(path.join(f.root, ".claude", "skills", skill)).isSymbolicLink()).toBe(true);
    expect(existsSync(path.join(f.home, ".claude"))).toBe(false); // nothing is written in the user's home
    expect(existsSync(path.join(f.root, "projects", "alpha", "knowledge"))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(f.root, ".mcp.json"), "utf8")).mcpServers["mail-mcp"].url).toBe("http://localhost:8787");

    // owner edits config; a second install must not touch it
    const cfg = path.join(f.root, "config", "config.json");
    writeFileSync(cfg, readFileSync(cfg, "utf8").replace('"account": ""', '"account": "me@example.com"'));
    const before = snapshot(f.root);
    const r2 = await install(f.ctx, steps);
    expect(r2.filter((r) => r.outcome === "changed" || r.outcome === "failed")).toEqual([]);
    expect(snapshot(f.root)).toEqual(before);
    expect(readFileSync(cfg, "utf8")).toContain("me@example.com");
  });

  it("dry-run changes nothing and runs no apply", async () => {
    const f = fake({ dryRun: true });
    const before = snapshot(f.root);
    const r = await install(f.ctx, steps);
    expect(r.some((x) => x.outcome === "skipped")).toBe(true);
    expect(snapshot(f.root)).toEqual(before);
    expect(existsSync(path.join(f.home, "Library"))).toBe(false);
    expect(f.calls.some((c) => c.cmd === "launchctl")).toBe(false);
  });

  it("a project without project.md fails with a clear line", async () => {
    const f = fake();
    mkdirSync(path.join(f.root, "projects", "beta"), { recursive: true });
    const d = await doctor(f.ctx, projectSteps);
    expect(d[0]!.outcome).toBe("failed");
    expect(d[0]!.detail).toContain("beta: project.md");
  });

  it("uninstall removes the instance's own skill links, keeps config, and only reports old user-global links", async () => {
    const f = fake();
    const s1 = runtimeSkills(f.ctx)[0]!;
    await install(f.ctx, steps);
    const old = path.join(f.home, ".claude", "skills", s1); // what an older `hub setup` left in the user's home
    mkdirSync(path.dirname(old), { recursive: true });
    symlinkSync(path.join(f.ctx.paths.skills, s1), old);
    const abs = path.join(f.root, ".claude", "skills", s1); // an absolute link from an older core fails the check and install rewrites it
    rmSync(abs); symlinkSync(path.join(f.ctx.paths.skills, s1), abs);
    expect((await doctor(f.ctx, steps.filter((s) => s.id === "skills.runtime")))[0]!.outcome).toBe("failed");
    await install(f.ctx, steps.filter((s) => s.id === "skills.runtime"));
    expect(path.isAbsolute(readlinkSync(abs))).toBe(false);
    const legacy = await doctor(f.ctx, skillSteps.filter((s) => s.id === "skills.legacy"));
    expect(legacy[0]!.outcome).toBe("warn");
    expect(legacy[0]!.detail).toContain(`rm '${old}'`);
    const dry = await uninstall({ ...f.ctx, dryRun: true });
    expect(dry.some((l) => l.startsWith(`would unlink skill ${s1}`))).toBe(true);
    expect(existsSync(path.join(f.root, ".claude", "skills", s1))).toBe(true);
    const out = await uninstall(f.ctx);
    expect(existsSync(path.join(f.root, ".claude", "skills", s1))).toBe(false);
    expect(lstatSync(old).isSymbolicLink()).toBe(true); // outside the instance: reported, never deleted
    expect(out.join("\n")).toContain(`rm '${old}'`);
    expect(existsSync(path.join(f.root, "config", "config.json"))).toBe(true);
  });

  it("exit code is non-zero while manual steps remain", () => {
    expect(exitCode([{ step: steps[0]!, outcome: "manual", detail: "" }])).toBe(1);
    expect(exitCode([{ step: steps[0]!, outcome: "warn", detail: "" }])).toBe(0);
  });
});

describe("doctor reports as it goes", () => {
  it("hands each report to the caller the moment its step ends, in order, with its time", async () => {
    const f = fake();
    const seen: string[] = [];
    const slow = { id: "t.slow", group: "T", title: "slow", why: "", verifies: "", check: async () => { await new Promise((r) => setTimeout(r, 1100)); return { level: "pass" as const, detail: "late" }; } };
    const quick = { id: "t.quick", group: "T", title: "quick", why: "", verifies: "", check: async () => ({ level: "warn" as const, detail: "now" }) };
    const out = await doctor(f.ctx, [slow, quick], (r) => seen.push(`${r.step.id}:${r.outcome}:${r.ms! >= 1000}`));
    expect(seen).toEqual(["t.slow:ok:true", "t.quick:warn:false"]);
    expect(out.map((r) => r.ms !== undefined)).toEqual([true, true]);
    expect(table(out)).toMatch(/PASS\s+t\.slow\s+1\.\ds\s+late/);
    expect(slowest(out)).toMatch(/^slowest: t\.slow 1\.\ds; total /);
    expect(slowest([out[1]!])).toBe("");
  });
  it("a config key nothing reads is a WARN naming it; the keys the hub reads pass", async () => {
    const f = fake();
    const step = fileSteps.find((s) => s.id === "files.config-keys")!;
    writeFileSync(f.ctx.paths.configFile, JSON.stringify({ account: "a", mailboxes: [], allow_list: [], backup_dir: "x", admin_port: 1, api_port: 2, backup_repos: [], extra_dirs: [], sent_mailbox: "S" }));
    expect((await step.check(f.ctx)).level).toBe("pass");
    writeFileSync(f.ctx.paths.configFile, JSON.stringify({ account: "a", quiet_hours: {}, model: "sonnet", timeout_seconds: 600 }));
    const r = await step.check(f.ctx);
    expect(r.level).toBe("warn");
    expect(r.detail).toContain("quiet_hours, model, timeout_seconds");
    rmSync(f.ctx.paths.configFile);
    expect((await step.check(f.ctx)).level).toBe("pass");
  });
});
