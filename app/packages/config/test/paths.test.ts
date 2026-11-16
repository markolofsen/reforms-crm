import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_ROOT, hubPaths, pathsAt, projectFolder } from "../src/paths.js";

const empty = {} as NodeJS.ProcessEnv;
const instanceDir = () => mkdtempSync(join(tmpdir(), "hub-home-"));

describe("hubPaths with HUB_HOME unset", () => {
  const p = hubPaths({ env: empty });
  it("is the single-repo layout: home is the core checkout", () => {
    expect(p.home).toBe(CORE_ROOT);
    expect(p.core).toBe(CORE_ROOT);
    expect(p.instance).toBe(false);
  });
  it("puts every file where the code always looked", () => {
    expect(p.projects).toBe(join(CORE_ROOT, "app", "projects"));
    expect(p.db).toBe(join(CORE_ROOT, "app", "data", "app.db"));
    expect(p.state).toBe(join(CORE_ROOT, "state"));
    expect(p.secrets).toBe(join(CORE_ROOT, "state", "secrets"));
    expect(p.configFile).toBe(join(CORE_ROOT, "config", "config.json"));
    expect(p.mcpFile).toBe(join(CORE_ROOT, ".mcp.json"));
    expect(p.skills).toBe(join(CORE_ROOT, "skills"));
    expect(p.hubBin).toBe(join(CORE_ROOT, "app", "apps", "installer", "bin", "hub.mjs"));
  });
});

describe("hubPaths with HUB_HOME", () => {
  it("moves projects, data, state, secrets and config to the instance; code and skills stay in the core", () => {
    const home = instanceDir();
    const p = hubPaths({ env: { HUB_HOME: home } });
    expect(p.instance).toBe(true);
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
  it("treats HUB_HOME equal to the core as the single-repo layout", () => {
    expect(hubPaths({ env: { HUB_HOME: CORE_ROOT } }).instance).toBe(false);
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
  it("pathsAt is the single-folder layout of any folder, even with HUB_HOME set", () => {
    const root = instanceDir();
    mkdirSync(join(root, "app"), { recursive: true });
    const p = pathsAt(root, { HUB_HOME: instanceDir() });
    expect(p.home).toBe(root);
    expect(p.instance).toBe(false);
    expect(p.projects).toBe(join(root, "app", "projects"));
    expect(p.guardLog).toBe(join(root, "state", "guard.log"));
  });
  it("projectFolder joins the slug onto the projects folder", () => {
    const home = instanceDir();
    expect(projectFolder("acme", { env: { HUB_HOME: home } })).toBe(join(home, "projects", "acme"));
  });
});
