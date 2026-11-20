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
  it("Claude: Read and Edit denied on state/drops/<other>/** and state/drops/_shell/**, never on its own", () => {
    const { paths, projects } = instance();
    const rules = denyRules(projects, paths.home, "acme", paths);
    for (const tool of ["Read", "Edit"]) {
      expect(rules).toContain(`${tool}(./state/drops/beta/**)`);
      expect(rules).toContain(`${tool}(./state/drops/_shell/**)`);
    }
    expect(rules.filter((r) => r.includes("state/drops/acme"))).toEqual([]);
  });
  it("Codex: the profile makes them \"none\", and leaves its own readable", () => {
    const { paths, projects } = instance();
    const toml = codexConfigToml({ paths, projectsDir: projects, slug: "acme", unattended: false, servers: {}, instructions: "acme only", nodeBin: "/n/node" });
    expect(toml).toContain(`${JSON.stringify(dropFolder(paths, "beta"))} = "none"`);
    expect(toml).toContain(`${JSON.stringify(dropFolder(paths, null))} = "none"`);
    expect(toml).not.toContain(JSON.stringify(dropFolder(paths, "acme")));
  });
});
