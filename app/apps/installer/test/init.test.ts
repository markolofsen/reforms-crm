import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ghCreateLine, githubOwner, initInstance, INSTANCE_TEMPLATE, InitError, instanceDir, kindFromAnswer, kindQuestion, pinFile, renderTemplate, templateFiles } from "../src/init";
import { situationOf } from "../src/setup/situation";
import { KIND_IDS } from "@hub/projects";
import { loadProject } from "@hub/projects";
import { readCoreVersion } from "@hub/config/core-version";
import { CORE_ROOT } from "@hub/config/paths";

// P35, P89: `hub new-instance` against a throw-away core (bare origin with tags v0.1.0, v0.2.0) and the REAL instance template of this checkout.
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const git = (cwd: string, ...a: string[]): string => execFileSync("git", ["-C", cwd, ...a], { env: ENV, encoding: "utf8" }).trim();
const put = (f: string, body: string) => { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, body); };

function rig() {
  const base = mkdtempSync(path.join(tmpdir(), "hub-init-"));
  const work = path.join(base, "work"), origin = path.join(base, "origin.git");
  put(path.join(work, "skills", "triage", "SKILL.md"), "---\nname: triage\n---\n");
  put(path.join(work, "hub.sh"), "#!/bin/sh\n");
  git(base, "init", "-q", "--bare", origin);
  git(base, "init", "-q", "-b", "main", work); git(work, "add", "-A"); git(work, "commit", "-qm", "one"); git(work, "tag", "v0.1.0");
  put(path.join(work, "NOTES.md"), "two\n"); git(work, "add", "-A"); git(work, "commit", "-qm", "two"); git(work, "tag", "v0.2.0");
  put(path.join(work, "NOTES.md"), "three\n"); git(work, "add", "-A"); git(work, "commit", "-qm", "three");
  git(work, "push", "-q", origin, "HEAD:refs/heads/main", "--tags");
  const calls: { cmd: string; args: string[]; env?: Record<string, string> }[] = [];
  const logs: string[] = [];
  const deps = {
    run: async (cmd: string, args: string[], opts?: { cwd?: string; env?: Record<string, string> }) => {
      if (cmd === "git") {
        try { return { code: 0, stdout: execFileSync("git", args, { env: ENV, encoding: "utf8", cwd: opts?.cwd }), stderr: "" }; }
        catch (e) { return { code: 1, stdout: "", stderr: String((e as { stderr?: string }).stderr ?? e) }; }
      }
      calls.push({ cmd, args, ...(opts?.env ? { env: opts.env } : {}) });
      return { code: 0, stdout: `ran ${path.basename(cmd)} ${args.join(" ")}`, stderr: "" };
    },
    log: (m: string) => logs.push(m),
    freeGb: async () => 100,
    today: () => "2026-11-20",
  };
  return { base, origin, work, calls, logs, deps };
}

describe("hub new-instance", () => {
  it("creates an instance on the newest tag: submodule, files, pin, skill links, commit", async () => {
    const r = rig();
    const dir = path.join(r.base, "acme");
    const out = await initInstance({ dir, coreUrl: r.origin }, r.deps);
    expect(out.pin).toBe("v0.2.0");
    expect(out.follows).toBe(false);
    expect(git(path.join(dir, "core"), "rev-parse", "HEAD")).toBe(git(r.work, "rev-parse", "v0.2.0"));
    expect(readCoreVersion(dir)).toBe(git(r.work, "rev-parse", "v0.2.0"));
    expect(readFileSync(path.join(dir, "core.version"), "utf8")).not.toContain("follows");
    expect(readFileSync(path.join(dir, "README.md"), "utf8")).toContain("# acme");
    expect(lstatSync(path.join(dir, "AGENTS.md")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(path.join(dir, "AGENTS.md"))).toBe("CLAUDE.md");
    expect(statSync(path.join(dir, "run.sh")).mode & 0o111).not.toBe(0);
    expect(lstatSync(path.join(dir, ".claude", "skills", "triage")).isSymbolicLink()).toBe(true);
    expect(readFileSync(path.join(dir, ".gitmodules"), "utf8")).toContain("core");
    expect(git(dir, "log", "--oneline")).toContain("created by hub new-instance");
    expect(git(dir, "status", "--porcelain")).toBe("");
    // the instance's own core does the rest, with HUB_HOME set to the new folder
    expect(r.calls.map((c) => `${path.basename(c.cmd)} ${c.args.join(" ")}`)).toEqual(["pnpm install --frozen-lockfile", "hub.sh install --only Files", "hub.sh doctor"]);
    expect(r.calls[1]!.env).toEqual({ HUB_HOME: dir });
  });

  it("main follows the tip and says so in core.version", async () => {
    const r = rig();
    const dir = path.join(r.base, "acme");
    const out = await initInstance({ dir, coreUrl: r.origin, pin: "main" }, r.deps);
    expect(out.follows).toBe(true);
    expect(readFileSync(path.join(dir, "core.version"), "utf8")).toContain("# follows: main");
    expect(readCoreVersion(dir)).toBe(git(r.work, "rev-parse", "main"));
  });

  it("an explicit tag is honoured; an unknown one fails with one line", async () => {
    const r = rig();
    await initInstance({ dir: path.join(r.base, "a"), coreUrl: r.origin, pin: "v0.1.0" }, r.deps);
    expect(readCoreVersion(path.join(r.base, "a"))).toBe(git(r.work, "rev-parse", "v0.1.0"));
    await expect(initInstance({ dir: path.join(r.base, "b"), coreUrl: r.origin, pin: "v9.9.9" }, r.deps)).rejects.toThrow(/no tag v9\.9\.9/);
  });

  it("never pins a tag that is not a version, by discovery or by --pin", async () => {
    const r = rig();
    git(r.work, "tag", "zz-backup-2026"); // sorts before every vX.Y.Z in `ls-remote --sort=-v:refname`
    git(r.work, "push", "-q", r.origin, "--tags");
    const dir = path.join(r.base, "acme");
    const out = await initInstance({ dir, coreUrl: r.origin }, r.deps);
    expect(out.pin).toBe("v0.2.0");
    expect(readFileSync(path.join(dir, "core.version"), "utf8")).toContain("# tag: v0.2.0");
    await expect(initInstance({ dir: path.join(r.base, "b"), coreUrl: r.origin, pin: "zz-backup-2026" }, r.deps)).rejects.toThrow(/vX\.Y\.Z tag or main/);
  });

  it("a failed commit is an error that says how to finish, not a success", async () => {
    const r = rig();
    const deps = { ...r.deps, run: async (cmd: string, args: string[], o?: { cwd?: string; env?: Record<string, string> }) => cmd === "git" && args.includes("commit") ? { code: 128, stdout: "", stderr: "fatal: unable to auto-detect email address" } : r.deps.run(cmd, args, o) };
    const dir = path.join(r.base, "nocommit");
    await expect(initInstance({ dir, coreUrl: r.origin }, deps)).rejects.toThrow(/git commit failed: fatal: unable to auto-detect email/);
  });

  it("refuses a folder that is not empty and writes nothing there", async () => {
    const r = rig();
    const dir = path.join(r.base, "full");
    put(path.join(dir, "keep.txt"), "x");
    await expect(initInstance({ dir, coreUrl: r.origin }, r.deps)).rejects.toThrow(InitError);
    expect(readdirSync(dir)).toEqual(["keep.txt"]);
  });

  it("--dry-run lists the files and creates nothing", async () => {
    const r = rig();
    const dir = path.join(r.base, "dry");
    const out = await initInstance({ dir, coreUrl: r.origin, dryRun: true }, r.deps);
    expect(existsSync(dir)).toBe(false);
    expect(out.files).toContain("run.sh");
    expect(out.files).toContain("core.version");
    expect(r.logs.join("\n")).toContain("would create");
  });

  it("a failed pnpm install is reported and the instance is still committed", async () => {
    const r = rig();
    const deps = { ...r.deps, run: async (cmd: string, args: string[], o?: { cwd?: string; env?: Record<string, string> }) => cmd === "pnpm" ? { code: 1, stdout: "", stderr: "no pnpm" } : r.deps.run(cmd, args, o) };
    const dir = path.join(r.base, "nopnpm");
    await initInstance({ dir, coreUrl: r.origin }, deps);
    expect(r.logs.join("\n")).toContain("pnpm install failed");
    expect(git(dir, "log", "--oneline")).toContain("created by hub new-instance");
  });
});

describe("hub new-instance (P89)", () => {
  it("a bare name is ./hub-<name>, a hub- prefix is not doubled, a path is kept; the gh line is private and names the core's owner", () => {
    expect(instanceDir("saas", "/w")).toBe("/w/hub-saas");
    expect(instanceDir("hub-saas", "/w")).toBe("/w/hub-saas");
    expect(instanceDir("./x/y", "/w")).toBe("/w/x/y");
    // inside a checkout (the core, an instance) the new folder goes next to it, never inside it
    expect(instanceDir("acme", "/w/reforms-crm/app", "/w/reforms-crm")).toBe("/w/hub-acme");
    expect(instanceDir("./here", "/w/reforms-crm", "/w/reforms-crm")).toBe("/w/reforms-crm/here");
    expect(githubOwner("https://github.com/acme/reforms-crm.git")).toBe("acme");
    expect(githubOwner("git@github.com:acme/reforms-crm.git")).toBe("acme");
    expect(ghCreateLine("https://github.com/acme/reforms-crm.git", "/w/hub-saas")).toBe('gh repo create acme/hub-saas --private --source "/w/hub-saas" --remote origin --push');
    expect(ghCreateLine("/local/core", "/w/hub-x")).toContain("<your-github-user>/hub-x --private");
  });

  it("--kind writes the first project from the template: project.md (draft), taxonomy, empty knowledge, workflows, sequences, @dev", async () => {
    const r = rig();
    const dir = path.join(r.base, "hub-acme");
    const out = await initInstance({ dir, coreUrl: r.origin, kind: "software-support" }, r.deps);
    expect(out.project).toBe("acme");
    const md = readFileSync(path.join(dir, "projects", "acme", "project.md"), "utf8");
    expect(md).toContain("| kind | software-support | 2026-11-20 | owner |");
    expect(md).toContain("| status | draft |");
    const parsed = loadProject(path.join(dir, "projects"), "acme").parsed;
    expect(parsed.config).toMatchObject({ kind: "software-support", status: "draft" });
    expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(readFileSync(path.join(dir, "projects", "acme", "knowledge", "taxonomy.md"), "utf8")).toContain("PRICING, API, BILLING");
    for (const sub of ["workflows/README.md", "sequences/README.md", "@dev/README.md", "knowledge/files/.gitkeep"]) expect(existsSync(path.join(dir, "projects", "acme", sub)), sub).toBe(true);
    expect(git(dir, "log", "--oneline")).toContain("project acme (software-support)");
    expect(git(dir, "status", "--porcelain")).toBe("");
    // `./run.sh setup` in the fresh folder sees a new instance (the project is a draft, no database yet), not a teammate's join.
    expect(situationOf({ projects: path.join(dir, "projects"), db: path.join(dir, "data", "app.db") }).situation).toBe("new");
  });

  it("P91: on a terminal without --kind one question lists the kinds; a number, a name or Enter answers it", () => {
    const q = kindQuestion();
    KIND_IDS.forEach((id, i) => expect(q).toContain(`${i + 1}. ${id}`));
    expect(q).toContain("Enter: no project yet");
    expect(kindFromAnswer("")).toEqual({});
    expect(kindFromAnswer("  ")).toEqual({});
    expect(kindFromAnswer("1")).toEqual({ kind: KIND_IDS[0] });
    expect(kindFromAnswer(String(KIND_IDS.length))).toEqual({ kind: KIND_IDS[KIND_IDS.length - 1] });
    expect(kindFromAnswer(" Sales-Pipeline ")).toEqual({ kind: "sales-pipeline" });
    expect(kindFromAnswer("0")).toHaveProperty("error");
    expect(kindFromAnswer(String(KIND_IDS.length + 1))).toHaveProperty("error");
    expect(kindFromAnswer("realty")).toHaveProperty("error");
  });

  it("an unknown kind or a bad slug fails with one line", async () => {
    const r = rig();
    await expect(initInstance({ dir: path.join(r.base, "a"), coreUrl: r.origin, kind: "nope" }, r.deps)).rejects.toThrow(/unknown kind "nope"/);
    await expect(initInstance({ dir: path.join(r.base, "b"), coreUrl: r.origin, kind: "generic", project: "Bad Slug" }, r.deps)).rejects.toThrow(/lower case/);
  });

  it("--no-install runs nothing of this Mac's; under 5 GB free the install is skipped and said so", async () => {
    const r = rig();
    await initInstance({ dir: path.join(r.base, "a"), coreUrl: r.origin, install: false }, r.deps);
    expect(r.calls).toEqual([]);
    const low = { ...r.deps, freeGb: async () => 1.3 };
    await initInstance({ dir: path.join(r.base, "b"), coreUrl: r.origin }, low);
    expect(r.calls).toEqual([]);
    expect(r.logs.join("\n")).toContain("only 1.3 GB free (under 5 GB): pnpm install skipped");
  });
});

describe("the instance template of this core", () => {
  it("has exactly the files an instance needs and no owner fact", () => {
    expect(templateFiles(CORE_ROOT)).toEqual([
      ".gitignore", "@dev/README.md", "@dev/_archive/.gitkeep", "@dev/active/.gitkeep", "@dev/blocked/.gitkeep", "@dev/completed/.gitkeep",
      "@dev/decisions/.gitkeep", "@dev/planned/.gitkeep", "@dev/research/.gitkeep", "@docs/custom/README.md", "@refs/README.md", "AGENTS.md", "CLAUDE.md",
      "README.md", "config/.gitkeep", "core.version", "run.sh", "state/.gitkeep",
    ]);
    expect(existsSync(path.join(CORE_ROOT, INSTANCE_TEMPLATE, "run.sh"))).toBe(true);
  });
  it("fills {{NAME}} and leaves unknown tokens alone; the pin file states follows only for main", () => {
    expect(renderTemplate("# {{NAME}} {{OTHER}}", { NAME: "x" })).toBe("# x {{OTHER}}");
    expect(pinFile("abc", { branch: "main" })).toContain("# follows: main");
    expect(pinFile("abc", { tag: "v1.2.3" })).toContain("# tag: v1.2.3");
    expect(pinFile("abc", { tag: "v1.2.3" })).not.toContain("follows");
  });
});
