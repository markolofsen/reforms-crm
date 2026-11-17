import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hubPaths } from "@hub/config/paths";
import { makeCtx, type Runner } from "../src/context.ts";
import { coreDev, coreInstall } from "../src/core-link.ts";
import { coreUpdate } from "../src/core-update.ts";
import { CORE_VERSION_FILE, checkInstance } from "../src/steps/instance.ts";

// `hub core install` and `hub core dev <path>`: throw-away git repos only. The instance records core/ as a submodule; a second repo is the developer's core checkout.
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const git = (cwd: string, ...a: string[]): string => execFileSync("git", ["-C", cwd, "-c", "protocol.file.allow=always", ...a], { env: ENV, encoding: "utf8" }).trim();
const put = (f: string, body: string) => { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, body); };
// The hub's runner, but git may clone from a local path in the test.
const run: Runner = async (cmd, args) => {
  try { return { code: 0, stdout: execFileSync(cmd, cmd === "git" ? ["-c", "protocol.file.allow=always", ...args] : args, { env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), stderr: "" }; }
  catch (e) { const x = e as { status?: number; stdout?: string; stderr?: string }; return { code: x.status ?? 1, stdout: String(x.stdout ?? ""), stderr: String(x.stderr ?? "") }; }
};

function coreRepo(dir: string) {
  put(path.join(dir, "hub.sh"), "#!/bin/sh\n");
  put(path.join(dir, "app", "apps", "installer", "package.json"), "{}\n");
  put(path.join(dir, "skills", "triage", "SKILL.md"), "---\nname: triage\n---\n");
  git(path.dirname(dir), "init", "-q", dir); git(dir, "add", "-A"); git(dir, "commit", "-qm", "core");
}

function rig() {
  const base = mkdtempSync(path.join(tmpdir(), "hub-core-link-"));
  const origin = path.join(base, "origin"), dev = path.join(base, "my-core"), home = path.join(base, "acme");
  coreRepo(origin); coreRepo(dev);
  git(base, "init", "-q", home);
  git(home, "submodule", "add", "-q", origin, "core");
  const sha = git(path.join(home, "core"), "rev-parse", "HEAD");
  put(path.join(home, CORE_VERSION_FILE), `${sha}\n`);
  put(path.join(home, "projects", "acme", "project.md"), "# acme\n");
  git(home, "add", "-A"); git(home, "commit", "-qm", "instance");
  const ctx = makeCtx({ paths: hubPaths({ core: path.join(home, "core"), home, env: {} }), log: () => {}, run });
  return { base, origin, dev, home, ctx, sha };
}
const status = (home: string) => git(home, "status", "--porcelain");

describe("hub core dev", () => {
  it("is a dry run without --apply", async () => {
    const r = rig();
    const o = await coreDev(r.ctx, r.dev, false);
    expect(o.ok, o.lines.join("\n")).toBe(true);
    expect(o.lines.join("\n")).toContain("would link");
    expect(lstatSync(path.join(r.home, "core")).isSymbolicLink()).toBe(false);
  });
  it("replaces the submodule checkout with a link, and git no longer sees core/", async () => {
    const r = rig();
    const o = await coreDev(r.ctx, r.dev, true);
    expect(o.ok, o.lines.join("\n")).toBe(true);
    expect(readlinkSync(path.join(r.home, "core"))).toBe(r.dev);
    expect(status(r.home)).toBe("");
    // An instance commit made while linked never takes the link along.
    put(path.join(r.home, "projects", "acme", "note.md"), "x\n");
    git(r.home, "add", "-A"); git(r.home, "commit", "-qm", "note");
    expect(git(r.home, "show", "--name-only", "--format=", "HEAD")).toBe("projects/acme/note.md");
    expect(git(r.home, "ls-files", "--stage", "core")).toMatch(/^160000 /);
    expect(readFileSync(path.join(r.home, CORE_VERSION_FILE), "utf8")).toContain(r.sha);
  });
  it("the instance check warns (dev link), not fails, and says what it means", async () => {
    const r = rig();
    await coreDev(r.ctx, r.dev, true);
    const c = await checkInstance(r.ctx);
    expect(c.level).toBe("warn");
    expect(c.detail).toContain("local development");
  });
  it("is idempotent, and relinks to another checkout", async () => {
    const r = rig();
    await coreDev(r.ctx, r.dev, true);
    expect((await coreDev(r.ctx, r.dev, true)).lines.join("\n")).toContain("nothing to do");
    const other = path.join(r.base, "other-core"); coreRepo(other);
    const o = await coreDev(r.ctx, other, true);
    expect(o.ok, o.lines.join("\n")).toBe(true);
    expect(readlinkSync(path.join(r.home, "core"))).toBe(other);
  });
  it("refuses a folder that is not a core checkout, a dirty submodule, and a non-submodule instance", async () => {
    const r = rig();
    const plain = path.join(r.base, "plain"); mkdirSync(plain);
    expect((await coreDev(r.ctx, plain, true)).ok).toBe(false);
    put(path.join(r.home, "core", "skills", "triage", "SKILL.md"), "changed\n");
    const d = await coreDev(r.ctx, r.dev, true);
    expect(d.ok).toBe(false);
    expect(d.lines.join("\n")).toContain("uncommitted");
    const lone = mkdtempSync(path.join(tmpdir(), "hub-core-link-lone-")); git(lone, "init", "-q");
    const c2 = makeCtx({ paths: hubPaths({ core: path.join(lone, "core"), home: lone, env: {} }), log: () => {}, run });
    expect((await coreDev(c2, r.dev, true)).lines.join("\n")).toContain("does not record core as a submodule");
  });
  it("core update refuses while linked", async () => {
    const r = rig();
    await coreDev(r.ctx, r.dev, true);
    const o = await coreUpdate(r.ctx, undefined, false);
    expect(o.ok).toBe(false);
    expect(o.lines.join("\n")).toContain("hub core install");
  });
});

describe("hub core install", () => {
  it("is a no-op on an installed core", async () => {
    const r = rig();
    const o = await coreInstall(r.ctx);
    expect(o.ok, o.lines.join("\n")).toBe(true);
    expect(o.lines.join("\n")).toContain(r.sha.slice(0, 9));
    expect(status(r.home)).toBe("");
  });
  it("undoes a dev link: the submodule is back at the pin and git is clean", async () => {
    const r = rig();
    await coreDev(r.ctx, r.dev, true);
    const o = await coreInstall(r.ctx);
    expect(o.ok, o.lines.join("\n")).toBe(true);
    expect(lstatSync(path.join(r.home, "core")).isSymbolicLink()).toBe(false);
    expect(existsSync(path.join(r.home, "core", "hub.sh"))).toBe(true);
    expect(git(path.join(r.home, "core"), "rev-parse", "HEAD")).toBe(r.sha);
    expect(status(r.home)).toBe("");
    const ck = await checkInstance(r.ctx);
    // The rig never ran `hub agent`, so a "skills not linked yet" note is expected; the dev-link note and any failure are not.
    expect(ck.level).not.toBe("fail");
    expect(ck.detail).not.toContain("local development");
  });
  it("restores a missing checkout", async () => {
    const r = rig();
    git(r.home, "submodule", "deinit", "-f", "core");
    const o = await coreInstall(r.ctx);
    expect(o.ok, o.lines.join("\n")).toBe(true);
    expect(existsSync(path.join(r.home, "core", "hub.sh"))).toBe(true);
  });
});

describe("hub core update from another core", () => {
  it("refuses: only the instance's own core/ is moved", async () => {
    const r = rig();
    const other = makeCtx({ paths: hubPaths({ core: r.dev, home: r.home, env: {} }), log: () => {}, run });
    const o = await coreUpdate(other, undefined, true);
    expect(o.ok).toBe(false);
    expect(o.lines.join("")).toContain("./run.sh core update");
  });
});
