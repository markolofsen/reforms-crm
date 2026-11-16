import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hubPaths } from "@hub/config/paths";
import { makeCtx } from "../src/context.ts";
import { coreUpdate, rewritePin } from "../src/core-update.ts";
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
  const ctx = makeCtx({ paths: hubPaths({ core, home, env: {} }), log: () => {} });
  return { core, home, ctx, v1, v2: git(work, "rev-parse", "v0.2.0") };
}
const pinOf = (home: string) => readFileSync(path.join(home, CORE_VERSION_FILE), "utf8");

describe("hub core update", () => {
  it("rewrites only the first non-comment line", () => {
    expect(rewritePin("# a\n\nabc\n# b\n", "def")).toBe("# a\n\ndef\n# b\n");
    expect(rewritePin("# only\n", "def")).toBe("# only\ndef\n");
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
  it("needs an instance", async () => {
    const r = rig();
    const c = makeCtx({ paths: hubPaths({ core: r.core, home: r.core, env: {} }), log: () => {} });
    expect((await coreUpdate(c, undefined, false)).ok).toBe(false);
  });
});
