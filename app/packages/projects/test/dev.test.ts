import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkDev, devTemplateFiles, indexDev, initDev, readKanban } from "../src/dev.js";
import { runDevIndex, runDevInit } from "../src/hub-commands.js";

// P41: a project's own @dev kanban. The generator is the one the Hub's own @dev uses (`hub dev index --path`).
const here = dirname(fileURLToPath(import.meta.url));
const plan = (status: string, extra = "") => `# T\n\nStatus: ${status}\nOwner: agent\nNext action: do the thing\n${extra}`;

function rig() {
  const root = join(mkdtempSync(join(tmpdir(), "hub-dev-")), "projects");
  cpSync(join(here, "fixtures", "projects"), root, { recursive: true });
  const slug = "acme-travel";
  const folder = join(root, slug);
  const lines: string[] = [];
  return { root, slug, folder, dev: join(folder, "@dev"), lines, o: { projectsRoot: root, out: (l: string) => lines.push(l) } };
}
const track = (dev: string, dir: string, name: string, text: string) => {
  mkdirSync(join(dev, dir, name), { recursive: true });
  writeFileSync(join(dev, dir, name, "PLAN.md"), text);
};

describe("the template skeleton", () => {
  it("is exactly these files, and its README table is current for an empty kanban", () => {
    expect(devTemplateFiles()).toEqual(["CLAUDE.md", "README.md", "_archive/.gitkeep", "active/.gitkeep", "blocked/.gitkeep", "completed/.gitkeep", "decisions/.gitkeep", "planned/.gitkeep", "research/.gitkeep"]);
    const r = rig();
    expect(initDev(r.slug, r.folder, true).ok).toBe(true);
    expect(readKanban(r.dev).stale).toBe(false);
    expect(readFileSync(join(r.dev, "README.md"), "utf8")).toContain(`${r.slug}: development kanban`);
  });
});

describe("hub dev init", () => {
  it("is a dry run by default, creates with --apply and never overwrites", () => {
    const r = rig();
    expect(runDevInit(r.slug, false, r.o)).toBe(0);
    expect(existsSync(r.dev)).toBe(false);
    expect(runDevInit(r.slug, true, r.o)).toBe(0);
    expect(existsSync(join(r.dev, "active"))).toBe(true);
    writeFileSync(join(r.dev, "CLAUDE.md"), "mine\n");
    r.lines.length = 0;
    expect(runDevInit(r.slug, true, r.o)).toBe(0);
    expect(readFileSync(join(r.dev, "CLAUDE.md"), "utf8")).toBe("mine\n");
    expect(r.lines.some((l) => l.startsWith("exists") && l.includes("CLAUDE.md"))).toBe(true);
    expect(r.lines.at(-1)).toContain("0 file(s) created");
  });
  it("refuses a folder with no project.md", () => {
    const r = rig();
    expect(initDev("nope", join(r.root, "nope"), true).ok).toBe(false);
  });
});

describe("the generator", () => {
  it("writes one row per plan, owner cut at the first ; ( or ., and --check passes after it", () => {
    const r = rig();
    initDev(r.slug, r.folder, true);
    track(r.dev, "active", "p2-b", plan("ACTIVE", "").replace("Owner: agent", "Owner: Mark (owner)"));
    track(r.dev, "active", "p10-a", plan("ACTIVE"));
    track(r.dev, "completed", "p1-done", plan("DONE"));
    expect(runDevIndex(r.slug, undefined, true, r.o)).toBe(1);
    expect(runDevIndex(r.slug, undefined, false, r.o)).toBe(0);
    const text = readFileSync(join(r.dev, "README.md"), "utf8");
    expect(text.indexOf("p2-b")).toBeLessThan(text.indexOf("p10-a")); // natural order
    expect(text).toContain("| [p2-b](active/p2-b/PLAN.md) | ACTIVE | Mark | do the thing |");
    expect(text).toContain("| [p1-done](completed/p1-done/PLAN.md) | DONE | agent | do the thing |");
    r.lines.length = 0;
    expect(runDevIndex(r.slug, undefined, true, r.o)).toBe(0);
    expect(r.lines).toEqual(["ok: 3 tracks, README table matches the directories"]);
  });
  it("fails the check on a stale table, a Status that contradicts its directory and a track with no PLAN.md", () => {
    const r = rig();
    initDev(r.slug, r.folder, true);
    track(r.dev, "planned", "p3-x", plan("ACTIVE"));
    mkdirSync(join(r.dev, "blocked", "p4-empty"));
    const res = indexDev(r.dev, true, "hub dev index acme-travel");
    expect(res.ok).toBe(false);
    expect(res.lines).toEqual(expect.arrayContaining(["blocked/p4-empty: no PLAN.md", "planned/p3-x: plan Status says ACTIVE, directory says PLANNED", expect.stringContaining("stale: run `hub dev index acme-travel`")]));
  });
  it("--path works on any folder with the markers, and reports a missing marker instead of writing", () => {
    const r = rig();
    initDev(r.slug, r.folder, true);
    expect(runDevIndex(undefined, r.dev, true, r.o)).toBe(0);
    writeFileSync(join(r.dev, "README.md"), "# no markers\n");
    expect(runDevIndex(undefined, r.dev, false, r.o)).toBe(1);
    expect(readFileSync(join(r.dev, "README.md"), "utf8")).toBe("# no markers\n");
    expect(runDevIndex("a", "b", false, r.o)).toBe(2);
  });
  it("with no argument runs every project that has an @dev", () => {
    const r = rig();
    r.lines.length = 0;
    expect(runDevIndex(undefined, undefined, true, r.o)).toBe(0);
    expect(r.lines[0]).toContain("no project has an @dev folder");
    initDev(r.slug, r.folder, true);
    expect(runDevIndex(undefined, undefined, true, r.o)).toBe(0);
  });
});

describe("the doctor view", () => {
  it("WARN without a folder, PASS when current, FAIL when stale", () => {
    const r = rig();
    expect(checkDev(r.slug, r.folder).level).toBe("warn");
    initDev(r.slug, r.folder, true);
    expect(checkDev(r.slug, r.folder).level).toBe("pass");
    track(r.dev, "active", "p1-a", plan("ACTIVE"));
    const bad = checkDev(r.slug, r.folder);
    expect(bad.level).toBe("fail");
    expect(bad.detail).toContain(`hub dev index ${r.slug}`);
  });
});
