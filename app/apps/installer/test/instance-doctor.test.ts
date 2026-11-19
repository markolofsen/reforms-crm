import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hubPaths } from "@hub/config/paths";
import { makeCtx } from "../src/context";
import { syncInstanceSkills } from "../src/instance-skills";
import { INSTANCE_MARKER } from "@hub/config/paths";
import { writeCoreUpdateCache, type CoreUpdate } from "@hub/config/core-version";
import { checkInstance, coreUpdateNote } from "../src/steps/instance";
import { STEPS } from "../src/steps/index";

// Decision 0016, phase S4: `hub doctor` compares the instance with the core. Fixtures: throw-away folders, a throw-away git
// core, names like acme. Nothing here reads the real checkout or any real instance.
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const git = (cwd: string, ...a: string[]): string => execFileSync("git", ["-C", cwd, ...a], { env: ENV, encoding: "utf8" }).trim();
const put = (f: string, body = "x\n") => { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, body); };

interface Rig { base: string; core: string; home: string; pin: string }
/** A core that is its own git repo (one skill, the project template), an empty instance pinned to the core's HEAD. */
function rig(): Rig {
  const base = mkdtempSync(path.join(tmpdir(), "hub-doctor-"));
  const core = path.join(base, "core");
  const home = path.join(base, "acme-instance");
  put(path.join(core, "skills", "triage", "SKILL.md"), "---\nname: triage\n---\n");
  put(path.join(core, "app", "projects", "_template", "README.md"));
  put(path.join(core, ".gitignore"), "app/projects/*/dumps/\n");
  git(core, "init", "-q"); git(core, "add", "-A"); git(core, "commit", "-qm", "core");
  mkdirSync(path.join(home, "projects", "acme"), { recursive: true });
  const pin = git(core, "rev-parse", "HEAD");
  put(path.join(home, INSTANCE_MARKER), `# the core this instance runs on\n${pin}\n`);
  return { base, core, home, pin };
}
const ctxOf = (r: Rig) => makeCtx({ paths: hubPaths({ core: r.core, home: r.home, env: {} }), log: () => {} });
const linked = (r: Rig) => { syncInstanceSkills(hubPaths({ core: r.core, home: r.home, env: {} })); return r; };

describe("hub doctor: instance against core", () => {
  it("is a step of the default list", () => {
    expect(STEPS.find((s) => s.id === "instance.core")).toBeTruthy();
    expect(STEPS.find((s) => s.id === "instance.core")?.optional).toBeUndefined();
  });
  it("passes: pin equals the core's HEAD, clean core, no leaks, skills linked", async () => {
    const r = linked(rig());
    const out = await checkInstance(ctxOf(r));
    expect(out.level, out.detail).toBe("pass");
    expect(out.detail).toContain(r.pin);
  });
  it("fails when core.version is missing, and when it is only comments", async () => {
    const r = linked(rig());
    rmSync(path.join(r.home, INSTANCE_MARKER));
    expect(await checkInstance(ctxOf(r))).toMatchObject({ level: "fail", detail: expect.stringContaining("core.version missing") });
    put(path.join(r.home, INSTANCE_MARKER), "# nothing\n\n");
    expect((await checkInstance(ctxOf(r))).level).toBe("fail");
  });
  it("fails when the pin is not a commit of the core, or the core moved off the pin", async () => {
    const r = linked(rig());
    put(path.join(r.home, INSTANCE_MARKER), "deadbeefdeadbeef\n");
    expect(await checkInstance(ctxOf(r))).toMatchObject({ level: "fail", detail: expect.stringContaining("not a commit") });
    put(path.join(r.home, INSTANCE_MARKER), r.pin + "\n");
    put(path.join(r.core, "skills", "triage", "SKILL.md"), "---\nname: triage\n---\nmore\n");
    git(r.core, "commit", "-qam", "move");
    expect(await checkInstance(ctxOf(r))).toMatchObject({ level: "fail", detail: expect.stringContaining("pins") });
  });
  it("accepts a tag as the pin", async () => {
    const r = linked(rig());
    git(r.core, "tag", "v1");
    put(path.join(r.home, INSTANCE_MARKER), "v1\n");
    expect((await checkInstance(ctxOf(r))).level).toBe("pass");
  });
  it("warns how many newer version tags the core has, and not for a pin at the newest tag", async () => {
    const r = linked(rig());
    git(r.core, "tag", "v0.1.0");
    put(path.join(r.home, INSTANCE_MARKER), "# the core\nv0.1.0\n");
    expect((await checkInstance(ctxOf(r))).level).toBe("pass");
    for (const v of ["v0.2.0", "v0.10.0"]) { put(path.join(r.core, "skills", "triage", "SKILL.md"), `---\nname: triage\n---\n${v}\n`); git(r.core, "commit", "-qam", v); git(r.core, "tag", v); }
    git(r.core, "tag", "backup-2026"); // not a version: never counted
    git(r.core, "checkout", "-q", "--detach", "v0.1.0");
    const out = await checkInstance(ctxOf(r));
    expect(out.level).toBe("warn");
    expect(out.detail).toContain("2 newer tag(s)");
    expect(out.detail).toContain("latest v0.10.0");
    git(r.core, "checkout", "-q", "--detach", "v0.10.0");
    put(path.join(r.home, INSTANCE_MARKER), "v0.10.0\n");
    expect((await checkInstance(ctxOf(r))).level).toBe("pass");
  });
  it("fails on a dirty core (tracked file edited)", async () => {
    const r = linked(rig());
    put(path.join(r.core, "skills", "triage", "SKILL.md"), "edited\n");
    expect(await checkInstance(ctxOf(r))).toMatchObject({ level: "fail", detail: expect.stringContaining("uncommitted") });
  });
  it("fails on a core file inside the instance", async () => {
    const r = linked(rig());
    put(path.join(r.home, "app", "packages", "x", "index.ts"));
    put(path.join(r.home, "install.sh"));
    const out = await checkInstance(ctxOf(r));
    expect(out.level).toBe("fail");
    expect(out.detail).toMatch(/core files inside the instance: .*app\/packages.*install\.sh/);
  });
  it("fails on an instance file tracked in the core, and ignores ignored leftovers", async () => {
    const r = linked(rig());
    put(path.join(r.core, "app", "projects", "acme", "dumps", "a.json"));
    expect((await checkInstance(ctxOf(r))).level, "ignored dump is not a tracked instance file").toBe("pass");
    put(path.join(r.core, "app", "projects", "acme", "project.md"));
    put(path.join(r.core, "@dev", "OWNER-TODO.md"));
    git(r.core, "add", "-A"); git(r.core, "commit", "-qm", "leak");
    put(path.join(r.home, INSTANCE_MARKER), git(r.core, "rev-parse", "HEAD") + "\n");
    const out = await checkInstance(ctxOf(r));
    expect(out.level).toBe("fail");
    expect(out.detail).toMatch(/instance files inside the core: .*@dev.*app\/projects\/acme/);
  });
  it("fails on a dangling skill link into the core", async () => {
    const r = linked(rig());
    symlinkSync(path.join(r.core, "skills", "gone"), path.join(r.home, ".claude", "skills", "gone"));
    expect(await checkInstance(ctxOf(r))).toMatchObject({ level: "fail", detail: expect.stringContaining("dangling: gone") });
  });
  it("warns, not fails, when core skills are not linked yet", async () => {
    const r = rig();
    expect(await checkInstance(ctxOf(r))).toMatchObject({ level: "warn", detail: expect.stringContaining("not linked") });
  });
  it("fails when the core is a folder inside another repository", async () => {
    const r = rig();
    const outer = path.join(r.base, "outer");
    put(path.join(outer, "hub", "skills", "triage", "SKILL.md"), "s\n");
    put(path.join(outer, "hub", "app", "projects", "_template", "README.md"));
    git(outer, "init", "-q"); git(outer, "add", "-A"); git(outer, "commit", "-qm", "outer");
    const pin = git(outer, "rev-parse", "HEAD");
    put(path.join(r.home, INSTANCE_MARKER), pin + "\n");
    const p = hubPaths({ core: path.join(outer, "hub"), home: r.home, env: {} });
    syncInstanceSkills(p);
    const out = await checkInstance(makeCtx({ paths: p, log: () => {} }));
    expect(out.level, out.detail).toBe("fail");
    expect(out.detail).toContain("inside another repository");
  });
  it("warns when the core is not a git checkout at all", async () => {
    const r = rig();
    rmSync(path.join(r.core, ".git"), { recursive: true });
    const out = await checkInstance(ctxOf(linked(r)));
    expect(out.level).toBe("warn");
    expect(out.detail).toContain("not a git checkout");
  });
});

describe("instance.core reads the server's core update check (P68 verdict 8)", () => {
  const answer = (r: Rig, over: Partial<CoreUpdate>): CoreUpdate => ({ pin: r.pin.slice(0, 9), inUse: r.pin.slice(0, 9), newest: "v0.12.12", level: "available", reason: "1 newer release (patch)", tags: [], facts: { dependencies: false, migrations: false, rollback: false }, command: [], checkedAt: new Date(Date.now() - 2 * 3600_000).toISOString(), ...over });
  const cache = (r: Rig, over: Partial<CoreUpdate>) => writeCoreUpdateCache(hubPaths({ core: r.core, home: r.home, env: {} }).coreUpdate, answer(r, over));
  it("recommended and required: WARN with the origin's tag, the reason and when it was checked", async () => {
    for (const level of ["recommended", "required"] as const) {
      const r = linked(rig());
      cache(r, { level, reason: "v0.13.0 is a new minor version (1 newer release); database migrates", newest: "v0.13.0" });
      const out = await checkInstance(ctxOf(r));
      expect(out.level).toBe("warn");
      expect(out.detail).toContain(`origin has v0.13.0, update ${level}: v0.13.0 is a new minor version (1 newer release); database migrates (checked 2 h ago)`);
      expect(out.detail).toContain("`hub core update v0.13.0 --apply`");
    }
  });
  it("available (a patch) and follows: PASS with a note, so setup reports no open item", async () => {
    const r = linked(rig());
    cache(r, {});
    const out = await checkInstance(ctxOf(r));
    expect(out.level, out.detail).toBe("pass");
    expect(out.detail).toContain("origin has v0.12.12, update available: 1 newer release (patch) (checked 2 h ago)");
    cache(r, { level: "follows", reason: "follows main: 3 commit(s) behind origin/main" });
    expect(await checkInstance(ctxOf(r))).toMatchObject({ level: "pass", detail: expect.stringContaining("follows main: 3 commit(s) behind") });
  });
  it("an origin that did not answer is a note on a PASS, never a failure", async () => {
    const r = linked(rig());
    cache(r, { level: "current", reason: "x is the newest release", error: { at: new Date().toISOString(), message: "origin unreachable: Could not resolve host" } });
    const out = await checkInstance(ctxOf(r));
    expect(out.level).toBe("pass");
    expect(out.detail).toContain("the last check failed: origin unreachable: Could not resolve host");
  });
  it("an answer about another pin is ignored: the local tags speak", async () => {
    const r = linked(rig());
    cache(r, { pin: "v0.0.1", level: "required" });
    expect((await checkInstance(ctxOf(r))).level).toBe("pass");
    expect(coreUpdateNote(answer(r, { level: "unknown" }), Date.now())).toBeUndefined();
    expect(coreUpdateNote(answer(r, { level: "current" }), Date.now())).toBeUndefined();
  });
});
