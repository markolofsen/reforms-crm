import { execa } from "execa";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_ROOT, hubPaths } from "@hub/config/paths";
import { defaultProjectsRoot, loadProjects } from "@hub/projects";
import { defaultDbPath, openDb } from "@hub/db";
import { listProjects, makeCtx } from "../src/context.ts";
import { evidenceDir } from "../src/evidence-store.ts";
import { auditLayout, guardDecision, runGuard, writeSessionFiles } from "../src/safety.ts";
import { syncInstanceSkills } from "../src/instance-skills.ts";

// Decision 0016, phase S1: with HUB_HOME naming a folder OUTSIDE this checkout (a sibling instance holding one fixture project),
// every reader and writer of projects, state, secrets, data and generated session files lands in that folder, and nothing
// reads the checkout's own app/projects, app/data or state.
const FIXTURES = path.join(CORE_ROOT, "app", "packages", "projects", "test", "fixtures", "projects");
const BIN = path.join(CORE_ROOT, "app", "apps", "installer", "bin", "hub.mjs");
const home = mkdtempSync(path.join(tmpdir(), "hub-instance-"));
const saved = { HUB_HOME: process.env.HUB_HOME, HUB_PROJECTS: process.env.HUB_PROJECTS, HUB_DB: process.env.HUB_DB, HUB_CONFIG_DIR: process.env.HUB_CONFIG_DIR };

// The checkout's own project names, read at run time: none of them may show up through an instance.
const coreProjects = (): string[] => {
  const dir = path.join(CORE_ROOT, "app", "projects");
  return existsSync(dir) ? readdirSync(dir).filter((n) => statSync(path.join(dir, n)).isDirectory() && !n.startsWith("_") && !n.startsWith(".")) : [];
};
const mtime = (f: string): number | null => (existsSync(f) ? statSync(f).mtimeMs : null);

beforeAll(() => {
  cpSync(path.join(FIXTURES, "acme-travel"), path.join(home, "projects", "acme-travel"), { recursive: true });
  cpSync(path.join(FIXTURES, "nordhaus"), path.join(home, "projects", "nordhaus"), { recursive: true });
  mkdirSync(path.join(home, "projects", "acme-travel", "knowledge"), { recursive: true });
  mkdirSync(path.join(home, "state"), { recursive: true });
  for (const k of Object.keys(saved)) delete process.env[k];
  process.env.HUB_HOME = home;
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe("an instance folder outside the checkout", () => {
  it("is what the context, the registry and the database resolve to", () => {
    const paths = hubPaths();
    expect(paths.home).toBe(home);
    expect(makeCtx().paths.home).toBe(home);
    expect(listProjects(makeCtx())).toEqual(["acme-travel", "nordhaus"]);
    expect(defaultProjectsRoot()).toBe(path.join(home, "projects"));
    expect(loadProjects(defaultProjectsRoot()).map((p) => p.slug)).toEqual(["acme-travel", "nordhaus"]);
    expect(defaultDbPath()).toBe(path.join(home, "data", "app.db"));
  });
  it("lists none of the checkout's own projects", () => {
    const seen = [...listProjects(makeCtx()), ...loadProjects(defaultProjectsRoot()).map((p) => p.slug)];
    for (const own of coreProjects()) expect(seen, `${own} leaked from the checkout`).not.toContain(own);
  });
  it("opens the default database inside the instance, never the checkout's", () => {
    const live = path.join(CORE_ROOT, "app", "data", "app.db");
    const before = mtime(live);
    const h = openDb();
    h.close();
    expect(existsSync(path.join(home, "data", "app.db"))).toBe(true);
    expect(mtime(live)).toBe(before);
  });
  it("`hub projects` in a child process lists the instance, with HUB_PROJECTS and HUB_DB unset", async () => {
    const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", HUB_HOME: home };
    delete env.HUB_PROJECTS;
    delete env.HUB_DB;
    const r = await execa("node", [BIN, "projects", "--json"], { reject: false, env, extendEnv: false, timeout: 60000 });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(["acme-travel", "nordhaus"]);
  });
  it("evidence, the guard log and generated session files go under the instance's state", () => {
    const core = path.join(CORE_ROOT, "state", "guard.log");
    const before = mtime(core);
    const paths = hubPaths();
    expect(evidenceDir(paths.home, "acme-travel")).toBe(path.join(home, "state", "evidence", "acme-travel"));
    const bad = { tool_name: "Read", tool_input: { file_path: path.join(home, "projects", "nordhaus", "project.md") } };
    const r = runGuard(JSON.stringify(bad), { root: paths.home, paths, env: { HUB_PROJECT: "acme-travel" } });
    expect(r.stderr).toMatch(/touched projects\/nordhaus/);
    expect(readFileSync(path.join(home, "state", "guard.log"), "utf8")).toMatch(/warn acme-travel/);
    expect(mtime(core)).toBe(before);
    const files = writeSessionFiles(paths.home, paths.projects, "acme-travel", process.execPath, paths);
    expect(files.settings.startsWith(path.join(home, "state", "projects", "acme-travel"))).toBe(true);
  });
});

describe("what an agent started in an instance gets", () => {
  const paths = () => hubPaths();
  it("deny rules name the instance's folders, relative to where claude starts", () => {
    const f = writeSessionFiles(paths().home, paths().projects, "acme-travel", process.execPath, paths());
    expect(f.rules).toContain("Read(./projects/nordhaus/**)");
    expect(f.rules).toContain("Edit(./data/**)");
    expect(f.rules).toContain("Edit(./state/secrets/**)");
    expect(f.rules.some((r) => r.includes("acme-travel/**"))).toBe(false);
    expect(f.rules.join("\n")).not.toContain("app/projects");
  });
  it("the knowledge MCP server is started by absolute path in the core and told where the instance is", () => {
    const f = writeSessionFiles(paths().home, paths().projects, "acme-travel", process.execPath, paths());
    const s = (JSON.parse(readFileSync(f.mcp, "utf8")) as { mcpServers: Record<string, { command?: string; args?: string[]; env?: Record<string, string> }> }).mcpServers["knowledge-mcp"];
    expect(s?.command?.startsWith(CORE_ROOT)).toBe(true);
    expect(s?.args?.every((a) => path.isAbsolute(a))).toBe(true);
    expect(s?.env).toMatchObject({ HUB_PROJECT: "acme-travel", HUB_HOME: home });
    const hooks = readFileSync(f.settings, "utf8");
    expect(hooks).toContain(path.join(CORE_ROOT, "app", "apps", "installer", "bin", "hub.mjs"));
  });
  it("the audit sees a read of another project in the instance layout, and not a look-alike path elsewhere", () => {
    const layout = auditLayout(paths());
    const run = (file_path: string) => guardDecision({ tool_name: "Read", tool_input: { file_path } }, { slug: "acme-travel", accounts: [], mode: "block", layout }).violations;
    expect(run("projects/nordhaus/project.md")).toHaveLength(1);
    expect(run(path.join(home, "projects", "nordhaus", "project.md"))).toHaveLength(1);
    expect(run("projects/acme-travel/project.md")).toEqual([]);
    expect(run("projects/_template/project.md")).toEqual([]);
    expect(run("/work/@projects/nordhaus/x.md")).toEqual([]);
    expect(run(path.join(home, "data", "app.db"))).toHaveLength(1);
  });
  it("core skills are linked into <instance>/.claude/skills, idempotently, and an own skill is left alone", () => {
    const p = paths();
    mkdirSync(path.join(p.claudeSkills, "my-own"), { recursive: true });
    const first = syncInstanceSkills(p);
    expect(first.length).toBeGreaterThan(5);
    const one = first[0]!;
    const rel = readlinkSync(path.join(p.claudeSkills, one));
    expect(path.isAbsolute(rel)).toBe(false); // relative: the link survives moving the instance
    expect(realpathSync(path.join(p.claudeSkills, one))).toBe(realpathSync(path.join(CORE_ROOT, "skills", one)));
    expect(syncInstanceSkills(p)).toEqual([]);
    rmSync(path.join(p.claudeSkills, one)); // an absolute link from an older core is replaced by the relative one
    symlinkSync(path.join(CORE_ROOT, "skills", one), path.join(p.claudeSkills, one));
    expect(syncInstanceSkills(p)).toEqual([one]);
    expect(path.isAbsolute(readlinkSync(path.join(p.claudeSkills, one)))).toBe(false);
    expect(lstatSync(path.join(p.claudeSkills, "my-own")).isSymbolicLink()).toBe(false);
    symlinkSync(path.join(CORE_ROOT, "skills", "retired-skill"), path.join(p.claudeSkills, "retired-skill"));
    syncInstanceSkills(p);
    expect(existsSync(path.join(p.claudeSkills, "retired-skill"))).toBe(false);
    writeFileSync(path.join(home, ".claude", "keep"), "x");
  });
  it("without HUB_HOME an instance command exits 2 with one line, and commands that need none still work", async () => {
    const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" };
    delete env.HUB_HOME;
    const run = (...args: string[]) => execa("node", [BIN, ...args], { reject: false, env, extendEnv: false, timeout: 60000 });
    for (const cmd of [["doctor"], ["agent", "x"], ["projects"], ["setup", "--dry-run"], ["core", "update"], ["audit-run", "x.jsonl", "--project", "p"]]) {
      const r = await run(...cmd);
      expect(r.exitCode, cmd.join(" ")).toBe(2);
      expect(r.stderr.trim().split("\n")).toEqual(["error: no instance: run hub inside an instance folder (one with core.version), or export HUB_HOME"]);
    }
    expect((await run("--help")).exitCode).toBe(0);
    expect((await run("guide")).exitCode).toBe(0);
    expect((await run("docs", "--check")).exitCode, "docs --check").toBe(0);
  });
});
