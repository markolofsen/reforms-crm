import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hubPaths } from "@hub/config/paths";
import { defaultRunner, makeCtx, type Runner } from "../src/context.ts";
import { coreUpdate, pinMark, rewritePin } from "../src/core-update.ts";
import { CORE_VERSION_FILE } from "../src/steps/instance.ts";

// `hub core update` (decision 0016): fixtures only: a throw-away bare origin with tags v0.1.0 and v0.2.0, a clone as core, an acme instance.
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const git = (cwd: string, ...a: string[]): string => execFileSync("git", ["-C", cwd, ...a], { env: ENV, encoding: "utf8" }).trim();
const put = (f: string, body: string) => { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, body); };

function rig() {
  const base = mkdtempSync(path.join(tmpdir(), "hub-core-update-"));
  const work = path.join(base, "work"), origin = path.join(base, "origin.git"), core = path.join(base, "core"), home = path.join(base, "acme");
  put(path.join(work, "skills", "triage", "SKILL.md"), "---\nname: triage\n---\n");
  git(base, "init", "-q", "--bare", origin);
  git(base, "init", "-q", work); git(work, "add", "-A"); git(work, "commit", "-qm", "one"); git(work, "tag", "v0.1.0");
  put(path.join(work, "skills", "triage", "NOTES.md"), "two\n"); git(work, "add", "-A"); git(work, "commit", "-qm", "two"); git(work, "tag", "v0.2.0");
  git(work, "push", "-q", origin, "HEAD:refs/heads/main", "--tags");
  git(base, "clone", "-q", origin, core); git(core, "checkout", "-q", "v0.1.0");
  const v1 = git(core, "rev-parse", "HEAD");
  put(path.join(home, CORE_VERSION_FILE), `# the core\n${v1}\n`);
  mkdirSync(path.join(home, "projects", "acme"), { recursive: true });
  // git is real; pnpm is a recorder (never installs for real). `pnpmCode` makes it fail.
  const pnpm: { args: string[] }[] = [];
  const state = { pnpmCode: 0 };
  const real = defaultRunner(process.env.PATH ?? "/usr/bin:/bin");
  const run: Runner = async (cmd, args, opts) => cmd === "pnpm" ? (pnpm.push({ args }), { code: state.pnpmCode, stdout: "", stderr: state.pnpmCode ? "ERR_PNPM_FAKE no network" : "" }) : real(cmd, args, opts);
  const ctx = makeCtx({ paths: hubPaths({ core, home, env: {} }), log: () => {}, run });
  return { core, home, ctx, v1, v2: git(work, "rev-parse", "v0.2.0"), work, pnpm, state };
}
const pinOf = (home: string) => readFileSync(path.join(home, CORE_VERSION_FILE), "utf8");

describe("hub core update", () => {
  it("rewrites only the first non-comment line", () => {
    expect(rewritePin("# a\n\nabc\n# b\n", "def")).toBe("# a\n\ndef\n# b\n");
    expect(rewritePin("# only\n", "def")).toBe("# only\ndef\n");
  });
  it("writes one managed `# tag:` line and drops a hand-written version claim", () => {
    const stale = "# header\n# The core is checked out at the tag v0.1.0; this file states it once.\nabc\n# tag: v0.1.0\n";
    const out = pinMark(stale, { tag: "v0.6.12" });
    expect(out).toBe("# header\n# tag: v0.6.12\nabc\n");
    expect(out).not.toContain("v0.1.0");
    expect(pinMark(out, { branch: "main" })).toBe("# header\n# follows: main\nabc\n");
    expect(pinMark("# a\nabc\n", {})).toBe("# a\nabc\n");
  });
  it("lists the tags and changes nothing", async () => {
    const r = rig();
    const o = await coreUpdate(r.ctx, undefined, true);
    expect(o.ok).toBe(true);
    expect(o.lines.join("\n")).toContain("available: v0.1.0, v0.2.0");
    expect(pinOf(r.home)).toContain(r.v1);
  });
  it("is a dry run without --apply", async () => {
    const r = rig();
    const o = await coreUpdate(r.ctx, "v0.2.0", false);
    expect(o.lines.join("\n")).toContain("would move");
    expect(git(r.core, "rev-parse", "HEAD")).toBe(r.v1);
    expect(pinOf(r.home)).toContain(r.v1);
  });
  it("moves core and pin together, and the instance check passes", async () => {
    const r = rig();
    const o = await coreUpdate(r.ctx, "v0.2.0", true);
    expect(o.ok, o.lines.join("\n")).toBe(true);
    expect(git(r.core, "rev-parse", "HEAD")).toBe(r.v2);
    expect(pinOf(r.home)).toContain(r.v2);
    expect(pinOf(r.home)).toContain("# the core");
    expect(pinOf(r.home)).toContain("# tag: v0.2.0");
  });
  it("installs the dependencies when the lockfile changed, and only then", async () => {
    const r = rig();
    // v0.1.0 -> v0.2.0 changed no lockfile, and the fixture core has no node_modules: the install still runs because they are missing
    const o = await coreUpdate(r.ctx, "v0.2.0", true);
    expect(o.lines.join("\n")).toContain("core/app has no node_modules");
    expect(r.pnpm).toHaveLength(1);
    expect(r.pnpm[0]!.args).toEqual(["--dir", path.join(r.core, "app"), "install", "--frozen-lockfile", "--prefer-offline"]);
    // with node_modules present and no lockfile change: nothing runs
    mkdirSync(path.join(r.core, "app", "node_modules"), { recursive: true });
    await coreUpdate(r.ctx, "v0.1.0", true);
    expect(r.pnpm).toHaveLength(1);
    // a lockfile change between the two commits runs it
    put(path.join(r.work, "app", "pnpm-lock.yaml"), "lock: 1\n"); git(r.work, "add", "-A"); git(r.work, "commit", "-qm", "lock"); git(r.work, "tag", "v0.3.0");
    git(r.work, "push", "-q", git(r.core, "remote", "get-url", "origin"), "HEAD:refs/heads/main", "--tags");
    const o3 = await coreUpdate(r.ctx, "v0.3.0", true);
    expect(o3.lines.join("\n")).toContain("the lockfile changed");
    expect(r.pnpm).toHaveLength(2);
  });
  it("names the exact command when the install fails", async () => {
    const r = rig();
    r.state.pnpmCode = 1;
    const o = await coreUpdate(r.ctx, "v0.2.0", true);
    expect(o.ok).toBe(false);
    expect(o.lines.join("\n")).toContain(`Run: \`pnpm --dir ${path.join(r.core, "app")} install --frozen-lockfile --prefer-offline\``);
  });
  it("says it is a rollback when going back, and is a no-op when already there", async () => {
    const r = rig();
    await coreUpdate(r.ctx, "v0.2.0", true);
    const back = await coreUpdate(r.ctx, "v0.1.0", true);
    expect(back.lines.join("\n")).toContain("ROLLBACK");
    expect(git(r.core, "rev-parse", "HEAD")).toBe(r.v1);
    expect((await coreUpdate(r.ctx, "v0.1.0", true)).lines.join("\n")).toContain("nothing to do");
  });
  it("refuses an unknown tag and a dirty core", async () => {
    const r = rig();
    expect((await coreUpdate(r.ctx, "v9.9.9", true)).ok).toBe(false);
    writeFileSync(path.join(r.core, "skills", "triage", "SKILL.md"), "edited\n");
    const o = await coreUpdate(r.ctx, "v0.2.0", true);
    expect(o.ok).toBe(false);
    expect(o.lines.join("\n")).toContain("uncommitted");
    expect(git(r.core, "rev-parse", "HEAD")).toBe(r.v1);
  });
  it("puts everything back when the instance check fails after the move", async () => {
    const r = rig();
    put(path.join(r.home, "skills", "stray", "SKILL.md"), "core file in the instance\n"); // instance.core fails: a core path inside the instance
    const o = await coreUpdate(r.ctx, "v0.2.0", true);
    expect(o.ok).toBe(false);
    expect(o.lines.join("\n")).toContain("put back");
    expect(git(r.core, "rev-parse", "HEAD")).toBe(r.v1);
    expect(pinOf(r.home)).toContain(r.v1);
  });
});

describe("hub core update --branch", () => {
  it("follows the tip of origin/main and records it, then a tag pin removes the mark", async () => {
    const r = rig();
    const o = await coreUpdate(r.ctx, undefined, true, "main");
    expect(o.ok, o.lines.join("\n")).toBe(true);
    expect(git(r.core, "rev-parse", "HEAD")).toBe(r.v2);
    expect(pinOf(r.home)).toContain("# follows: main");
    expect(pinOf(r.home)).toContain(r.v2);
    expect((await coreUpdate(r.ctx, undefined, true, "main")).lines.join("\n")).toContain("nothing to do");
    const back = await coreUpdate(r.ctx, "v0.1.0", true);
    expect(back.ok, back.lines.join("\n")).toBe(true);
    expect(pinOf(r.home)).not.toContain("follows:");
  });
  it("refuses a branch that origin does not have", async () => {
    const r = rig();
    expect((await coreUpdate(r.ctx, undefined, true, "nope")).ok).toBe(false);
  });
});
