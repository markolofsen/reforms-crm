import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hubPaths, type HubPaths } from "@hub/config/paths";
import { claudeSettings } from "../src/claude";
import { codexConfigToml } from "../src/codex";
import { sessionCapabilities } from "../src/connectors";
import { denyRules } from "../src/deny";

// P140 K3 (owner, 2026-11-24): an attended session reads and edits `projects/**`, other projects included, and reads the
// database folder and the other tabs' drops; unattended keeps the strict list exactly.

let home: string;
let paths: HubPaths;
let projects: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "hub-attended-"));
  for (const p of ["acme", "beta"]) mkdirSync(path.join(home, "projects", p), { recursive: true });
  paths = hubPaths({ home, env: {} });
  projects = path.join(home, "projects");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** The file rules of the strict (unattended) list as they stood before P140, written out: the pin. */
const STRICT_FILE_RULES = [
  "./state/secrets/**",
  "./data/**",
  "./projects/beta/**",
  "./state/projects/beta/**",
  "./state/codex/beta/**",
  "./state/drops/beta/**",
  "./state/drops/_shell/**",
].flatMap((p) => [`Read(${p})`, `Edit(${p})`]);

const fileRules = (all: string[]) => all.filter((r) => /^(Read|Edit)\(/.test(r));

describe("P140 K3 the deny list by mode", () => {
  it("unattended keeps the strict list exactly (the pin)", () => {
    expect(fileRules(denyRules(projects, home, "acme", paths, true))).toEqual(STRICT_FILE_RULES);
    expect(fileRules(denyRules(projects, home, "acme", paths))).toEqual(STRICT_FILE_RULES);
  });

  it("attended: other projects' folders open; the database and the drops read only; secrets and the capability files closed", () => {
    const r = denyRules(projects, home, "acme", paths, false);
    expect(fileRules(r)).toEqual([
      "Read(./state/secrets/**)",
      "Edit(./state/secrets/**)",
      "Read(./state/projects/beta/**)",
      "Edit(./state/projects/beta/**)",
      "Read(./state/codex/beta/**)",
      "Edit(./state/codex/beta/**)",
      "Edit(./data/**)",
      "Edit(./state/drops/beta/**)",
      "Edit(./state/drops/_shell/**)",
    ]);
    expect(r).toContain("Bash(*state/secrets*)");
  });

  it("claudeSettings: the protected paths stay Edit-denied attended (core, config, the send policy, autopilot, .claude, .git, run.sh, CLAUDE.md, the log)", () => {
    const deny = (unattended: boolean) => (claudeSettings({ paths, projectsDir: projects, slug: "acme", nodeBin: "node", unattended }).permissions as { deny: string[] }).deny;
    const attended = deny(false);
    for (const p of ["./state/projects/**", "./state/autopilot.json", "./config/**", "./core/**", "./.claude/**", "./.git/**", "./run.sh", "./CLAUDE.md", "./AGENTS.md", "./state/log/**", "./.mcp.json"]) expect(attended).toContain(`Edit(${p})`);
    expect(attended).not.toContain("Read(./projects/beta/**)");
    expect(attended).not.toContain("Edit(./projects/beta/**)");
    // Unattended: the database folder is the sandbox's (left out of the rules, as before); everything else of the pin stays.
    const strict = deny(true);
    for (const r of STRICT_FILE_RULES.filter((x) => !x.includes("./data/**"))) expect(strict).toContain(r);
    expect(strict.filter((r) => r.includes("./data/**"))).toEqual([]);
  });

  it("Codex: other projects' folders are \"none\" unattended and \"read\" attended; their session files and Codex homes \"none\" in both", () => {
    const toml = (unattended: boolean) => codexConfigToml({ paths, projectsDir: projects, slug: "acme", unattended, servers: {}, instructions: "x", nodeBin: "/n/node" });
    const q = (p: string) => JSON.stringify(p);
    expect(toml(true)).toContain(`${q(path.join(projects, "beta"))} = "none"`);
    expect(toml(false)).toContain(`${q(path.join(projects, "beta"))} = "read"`);
    for (const t of [toml(true), toml(false)]) {
      expect(t).toContain(`${q(path.join(paths.stateProjects, "beta"))} = "none"`);
      expect(t).toContain(`${q(path.join(paths.codexHomes, "beta"))} = "none"`);
      expect(t).toContain(`${q(paths.secrets)} = "none"`);
    }
  });

  it("the capabilities line names the entry files only attended", () => {
    expect(sessionCapabilities("acme", [], "claude", undefined, false)).toContain("knowledge: the hub's knowledge_search and knowledge_get, and the entry files directly (attended)");
    expect(sessionCapabilities("acme", [], "claude", undefined, true)).not.toContain("entry files");
    expect(sessionCapabilities("acme", [], "claude")).not.toContain("entry files");
  });
});

