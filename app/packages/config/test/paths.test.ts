import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_ROOT, HubHomeMissingError, hubPaths, pathsAt, projectFolder } from "../src/paths";

const empty = {} as NodeJS.ProcessEnv;
const instanceDir = () => mkdtempSync(join(tmpdir(), "hub-home-"));

describe("hubPaths without an instance", () => {
  it("is a HubHomeMissingError with the one-line fix: there is no layout without HUB_HOME", () => {
    expect(() => hubPaths({ env: empty })).toThrow(HubHomeMissingError);
    expect(() => hubPaths({ env: { HUB_HOME: "  " } })).toThrow("no instance: run hub inside an instance folder (one with core.version), or export HUB_HOME");
  });
  it("the core is this checkout, never the instance", () => {
    expect(hubPaths({ env: { HUB_HOME: instanceDir() } }).core).toBe(CORE_ROOT);
  });
});

describe("hubPaths with HUB_HOME", () => {
  it("moves projects, data, state, secrets and config to the instance; code and skills stay in the core", () => {
    const home = instanceDir();
    const p = hubPaths({ env: { HUB_HOME: home } });
    expect(p.projects).toBe(join(home, "projects"));
    expect(p.db).toBe(join(home, "data", "app.db"));
    expect(p.state).toBe(join(home, "state"));
    expect(p.evidence).toBe(join(home, "state", "evidence"));
    expect(p.secrets).toBe(join(home, "state", "secrets"));
    expect(p.configFile).toBe(join(home, "config", "config.json"));
    expect(p.claudeSkills).toBe(join(home, ".claude", "skills"));
    expect(p.skills).toBe(join(CORE_ROOT, "skills"));
    expect(p.mcpDefaults).toBe(join(CORE_ROOT, "config", "mcp.json"));
  });
  it("refuses the core itself as HUB_HOME: the core holds no data", () => {
    expect(() => hubPaths({ env: { HUB_HOME: CORE_ROOT } })).toThrow(/core checkout itself/);
  });
  it("refuses a HUB_HOME that is not a folder: a typo must not start a second instance", () => {
    expect(() => hubPaths({ env: { HUB_HOME: join(tmpdir(), "hub-home-does-not-exist-xyz") } })).toThrow(/HUB_HOME is not a folder/);
  });
  it("lets the narrow overrides win, in that order of precedence", () => {
    const home = instanceDir();
    const env = { HUB_HOME: home, HUB_PROJECTS: "/x/projects", HUB_DB: "/x/app.db", HUB_CONFIG_DIR: "/x/secrets", HUB_CONFIG_FILE: "/x/config.json" };
    const p = hubPaths({ env });
    expect([p.projects, p.db, p.secrets, p.configFile]).toEqual(["/x/projects", "/x/app.db", "/x/secrets", "/x/config.json"]);
    expect(p.state).toBe(join(home, "state"));
  });
  it("ignores blank overrides", () => {
    const home = instanceDir();
    expect(hubPaths({ env: { HUB_HOME: home, HUB_PROJECTS: "  ", HUB_DB: "" } }).projects).toBe(join(home, "projects"));
  });
  it("an explicit home option beats the environment", () => {
    const a = instanceDir();
    const b = instanceDir();
    expect(hubPaths({ env: { HUB_HOME: a }, home: b }).home).toBe(b);
  });
});

describe("pathsAt and projectFolder", () => {
  it("pathsAt is the instance layout of the folder it is given, even with another HUB_HOME set", () => {
    const root = instanceDir();
    const p = pathsAt(root, { HUB_HOME: instanceDir() });
    expect(p.home).toBe(root);
    expect(p.projects).toBe(join(root, "projects"));
    expect(p.guardLog).toBe(join(root, "state", "guard.log"));
  });
  it("projectFolder joins the slug onto the projects folder", () => {
    const home = instanceDir();
    expect(projectFolder("acme", { env: { HUB_HOME: home } })).toBe(join(home, "projects", "acme"));
  });
});
