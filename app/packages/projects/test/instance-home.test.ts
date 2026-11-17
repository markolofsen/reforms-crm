import { cpSync, existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_ROOT } from "@hub/config/paths";
import { defaultDbPath } from "@hub/db";
import { runRename, runSync } from "../src/hub-commands";
import { defaultProjectsRoot, loadProjects } from "../src/registry";

// Decision 0016, S1: with HUB_HOME naming a folder outside the checkout, the registry reads and writes there and nowhere else.
const home = mkdtempSync(join(tmpdir(), "hub-projects-instance-"));
const saved = { HUB_HOME: process.env.HUB_HOME, HUB_PROJECTS: process.env.HUB_PROJECTS, HUB_DB: process.env.HUB_DB };
const mtime = (f: string): number | null => (existsSync(f) ? statSync(f).mtimeMs : null);

beforeAll(() => {
  cpSync(join(import.meta.dirname, "fixtures", "projects", "acme-travel"), join(home, "projects", "acme-travel"), { recursive: true });
  for (const k of Object.keys(saved)) delete process.env[k];
  process.env.HUB_HOME = home;
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe("@hub/projects under HUB_HOME", () => {
  it("reads the instance's projects folder, not the checkout's", () => {
    expect(defaultProjectsRoot()).toBe(join(home, "projects"));
    const slugs = loadProjects(defaultProjectsRoot()).map((p) => p.slug);
    expect(slugs).toEqual(["acme-travel"]);
    const own = join(CORE_ROOT, "app", "projects");
    if (existsSync(own)) for (const n of readdirSync(own).filter((x) => !x.startsWith("_") && !x.startsWith("."))) expect(slugs).not.toContain(n);
  });
  it("`project sync` writes the registry into the instance database and leaves the checkout's alone", async () => {
    const live = join(CORE_ROOT, "app", "data", "app.db");
    const before = mtime(live);
    const out: string[] = [];
    expect(await runSync({ out: (l) => out.push(l) })).toBe(0);
    expect(out.join("\n")).toMatch(/synced 1 project/);
    expect(existsSync(defaultDbPath())).toBe(true);
    expect(defaultDbPath()).toBe(join(home, "data", "app.db"));
    expect(mtime(live)).toBe(before);
  });
  it("`project rename` plans against the instance's folders and state", async () => {
    const out: string[] = [];
    expect(await runRename("acme-travel", "acme-trips", false, { out: (l) => out.push(l) })).toBe(0);
    expect(out.join("\n")).toContain(`rename folder ${join(home, "projects", "acme-travel")} -> ${join(home, "projects", "acme-trips")}`);
    expect(existsSync(join(home, "projects", "acme-travel", "project.md"))).toBe(true);
  });
});
