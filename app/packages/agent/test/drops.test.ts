import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dropFolder, hubPaths, type HubPaths } from "@hub/config/paths";
import { codexConfigToml } from "../src/codex";
import { denyRules } from "../src/deny";

// P76, decision 0041: a file dropped on a tab is that project's only. Other projects' and the Shell's drop folders are
// unreadable to a session: Claude's deny rules, the Codex profile.

function instance(): { paths: HubPaths; projects: string } {
  const home = mkdtempSync(path.join(tmpdir(), "hub-drops-"));
  for (const p of ["acme", "beta"]) mkdirSync(path.join(home, "projects", p), { recursive: true });
  return { paths: hubPaths({ home, env: {} }), projects: path.join(home, "projects") };
}

describe("drop folders of other projects", () => {
  it("Claude: never a rule on its own drops", () => {
    const { paths, projects } = instance();
    expect(denyRules(projects, paths.home, "acme", paths).filter((r) => r.includes("state/drops/acme"))).toEqual([]);
  });
  it("P140 K3: another tab's drops are readable, never editable", () => {
    const { paths, projects } = instance();
    const rules = denyRules(projects, paths.home, "acme", paths);
    expect(rules).toContain("Edit(./state/drops/beta/**)");
    expect(rules).toContain("Edit(./state/drops/_shell/**)");
    expect(rules).not.toContain("Read(./state/drops/beta/**)");
    expect(rules).not.toContain("Read(./state/drops/_shell/**)");
  });
  it("Codex: the profile makes them \"read\", and leaves its own as the workspace", () => {
    const { paths, projects } = instance();
    const toml = codexConfigToml({ paths, projectsDir: projects, slug: "acme", servers: {}, instructions: "acme only", nodeBin: "/n/node" });
    expect(toml).toContain(`${JSON.stringify(dropFolder(paths, "beta"))} = "read"`);
    expect(toml).toContain(`${JSON.stringify(dropFolder(paths, null))} = "read"`);
    expect(toml).not.toContain(JSON.stringify(dropFolder(paths, "acme")));
  });
});
