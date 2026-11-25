import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hubPaths, type HubPaths } from "@hub/config/paths";
import { claudeSettings } from "../src/claude";
import { codexConfigToml } from "../src/codex";
import { sessionCapabilities } from "../src/connectors";
import { denyRules } from "../src/deny";

// P140 K3 (owner, 2026-11-24): a session the owner started reads and edits `projects/**`, other projects included, and reads
// the database folder and the other tabs' drops. Owner 2026-11-25: one permission mode (no prompts, the OS sandbox) for every
// session, so these are the rules of every owner's session; a background run has no file tools at all.

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

const fileRules = (all: string[]) => all.filter((r) => /^(Read|Edit)\(/.test(r));

describe("P140 K3 the deny list of an owner's session", () => {
  it("other projects' folders open; the database and the drops read only; secrets and the capability files closed", () => {
    const r = denyRules(projects, home, "acme", paths);
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

  it("claudeSettings (3l): only the agent's own permissions, guards and the core stay Edit-denied; config, git and memory files are writable", () => {
    const settings = claudeSettings({ paths, projectsDir: projects, slug: "acme", nodeBin: "node" });
    const deny = (settings.permissions as { deny: string[] }).deny;
    for (const p of ["./state/projects/**", "./state/autopilot.json", "./state/secrets/**", "./config/config.json", "./config/mcp.json", "./core/**", "./.claude/**", "./.codex/**", "./run.sh", "./state/log/**", "./.mcp.json"]) expect(deny).toContain(`Edit(${p})`);
    for (const p of ["./config/**", "./.git/**", "./CLAUDE.md", "./AGENTS.md"]) expect(deny).not.toContain(`Edit(${p})`);
    expect(deny.filter((r) => r.startsWith("Read(") && !r.includes("state/projects/") && !r.includes("state/codex/"))).toEqual(["Read(./state/secrets/**)"]);
    expect(settings.sandbox).toMatchObject({ network: { allowedDomains: ["*"], allowLocalBinding: true } });
    expect((settings.sandbox as { network: { deniedDomains: string[] } }).network.deniedDomains).toEqual(expect.arrayContaining(["localhost", "*.localhost", "127.0.0.1", "::1", "0.0.0.0", "*.nip.io", "localtest.me"]));
    expect(deny).not.toContain("Read(./projects/beta/**)");
    expect(deny).not.toContain("Edit(./projects/beta/**)");
    // The database folder is the sandbox's (left out of the rules: they would become sandbox denials for the record writers).
    expect(deny.filter((r) => r.includes("./data/**"))).toEqual([]);
    expect(settings.sandbox).toMatchObject({ enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false });
  });

  it("Codex: other projects' folders are \"read\"; their session files and Codex homes \"none\"", () => {
    const t = codexConfigToml({ paths, projectsDir: projects, slug: "acme", servers: {}, instructions: "x", nodeBin: "/n/node" });
    const q = (p: string) => JSON.stringify(p);
    expect(t).toContain(`${q(path.join(projects, "beta"))} = "read"`);
    expect(t).toContain(`${q(path.join(paths.stateProjects, "beta"))} = "none"`);
    expect(t).toContain(`${q(path.join(paths.codexHomes, "beta"))} = "none"`);
    expect(t).toContain(`${q(paths.secrets)} = "none"`);
  });

  it("the capabilities line names the entry files", () => {
    expect(sessionCapabilities("acme", [], "claude")).toContain("knowledge: the hub's knowledge_search and knowledge_get, and the entry files directly");
  });
});
