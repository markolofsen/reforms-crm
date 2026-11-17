import { cpSync, existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_ROOT } from "@hub/config/paths";
import { createRepos, openDb } from "@hub/db";
import { defaultProjectsRoot } from "@hub/projects";
import { runSync as syncCommand } from "@hub/projects/hub-commands";
import { checkProject } from "../src/check";
import { indexProject } from "../src/indexer";
import { knowledgeSearch } from "../src/search";
import { fixtureRoot } from "./helpers";

// Decision 0016, S1: indexing, checking and searching a project's knowledge uses the instance's folder and database under HUB_HOME.
const home = mkdtempSync(join(tmpdir(), "hub-knowledge-instance-"));
const saved = { HUB_HOME: process.env.HUB_HOME, HUB_PROJECTS: process.env.HUB_PROJECTS, HUB_DB: process.env.HUB_DB };
const mtime = (f: string): number | null => (existsSync(f) ? statSync(f).mtimeMs : null);

beforeAll(() => {
  cpSync(join(fixtureRoot, "acme-travel"), join(home, "projects", "acme-travel"), { recursive: true });
  for (const k of Object.keys(saved)) delete process.env[k];
  process.env.HUB_HOME = home;
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe("@hub/knowledge under HUB_HOME", () => {
  it("indexes, checks and searches the instance's project through the default folder and database", async () => {
    const live = join(CORE_ROOT, "app", "data", "app.db");
    const before = mtime(live);
    expect(await syncCommand({ out: () => {} })).toBe(0);
    const handle = openDb();
    try {
      const repos = createRepos(handle.db);
      const root = defaultProjectsRoot();
      expect(root).toBe(join(home, "projects"));
      const r = await indexProject(repos, root, "acme-travel");
      expect(r.files).toBeGreaterThan(0);
      expect(r.invalid).toEqual([]);
      expect((await checkProject(repos, root, "acme-travel")).project).toBe("acme-travel");
      const found = await knowledgeSearch(repos, { project: "acme-travel", query: "visa" });
      expect(found.total).toBeGreaterThan(0);
    } finally {
      handle.close();
    }
    expect(existsSync(join(home, "data", "app.db"))).toBe(true);
    expect(mtime(live)).toBe(before);
    const own = join(CORE_ROOT, "app", "projects");
    const unnamed = existsSync(own) ? readdirSync(own).filter((n) => !n.startsWith("_") && !n.startsWith(".")) : [];
    for (const n of unnamed) expect(existsSync(join(home, "projects", n))).toBe(false);
  });
});
