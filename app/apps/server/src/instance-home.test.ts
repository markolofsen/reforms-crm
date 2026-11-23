import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_ROOT, hubPaths } from "@hub/config/paths";
import { createRepos, openDb } from "@hub/db";
import { loadProjects, syncProjects } from "@hub/projects";
import { readAllowList } from "@hub/projects";
import { configFile } from "./send/mailer";
import { projectOverview, projectsRoot } from "./project-overview";

// Decision 0016, S1: the server finds its projects, its send settings and its secrets in the instance named by HUB_HOME.
const home = mkdtempSync(join(tmpdir(), "hub-server-instance-"));
const saved = { HUB_HOME: process.env.HUB_HOME, HUB_PROJECTS: process.env.HUB_PROJECTS, HUB_DB: process.env.HUB_DB, HUB_CONFIG_DIR: process.env.HUB_CONFIG_DIR, HUB_CONFIG_FILE: process.env.HUB_CONFIG_FILE };

beforeAll(() => {
  const fixtures = join(CORE_ROOT, "app", "packages", "projects", "test", "fixtures", "projects");
  cpSync(join(fixtures, "acme-travel"), join(home, "projects", "acme-travel"), { recursive: true });
  mkdirSync(join(home, "projects", "acme-travel", "knowledge"), { recursive: true });
  mkdirSync(join(home, "config"), { recursive: true });
  writeFileSync(join(home, "config", "config.json"), JSON.stringify({ allow_list: ["client@example.com"] }));
  for (const k of Object.keys(saved)) delete process.env[k];
  process.env.HUB_HOME = home;
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe("the server under HUB_HOME", () => {
  it("reads projects, the allow-list and secrets from the instance", () => {
    expect(projectsRoot()).toBe(join(home, "projects"));
    expect(configFile()).toBe(join(home, "config", "config.json"));
    expect(readAllowList(configFile())).toEqual(["client@example.com"]);
    expect(hubPaths().secrets).toBe(join(home, "state", "secrets"));
  });
  it("answers a project overview from the instance's folder, and knows nothing of the checkout's projects", async () => {
    const handle = openDb(":memory:");
    try {
      const repos = createRepos(handle.db);
      const r = await syncProjects(repos, loadProjects(projectsRoot()));
      expect(r.ok).toBe(true);
      const mine = await projectOverview(repos, "acme-travel");
      expect(mine.project?.slug).toBe("acme-travel");
      expect(mine.knowledge.state).not.toBe("absent");
      const own = join(CORE_ROOT, "app", "projects");
      for (const n of existsSync(own) ? readdirSync(own).filter((x) => !x.startsWith("_") && !x.startsWith(".")) : []) {
        const other = await projectOverview(repos, n);
        expect(other.project, `${n} leaked from the checkout`).toBeNull();
        expect(other.knowledge.state).toBe("absent");
        expect(other.filters.state).toBe("absent");
      }
    } finally {
      handle.close();
    }
  });
});
