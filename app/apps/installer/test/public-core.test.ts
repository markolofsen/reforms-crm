import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultRoot } from "../src/context";
import { pathLeaks, TEXT_FILE, textLeaks } from "../src/leak-guard";

// P89 verdict 14 (decision 0043 point 8): the core is PUBLIC. It must never track a real project, an instance folder, working state,
// a database, an env file or a token. The same guard runs on every generated starter (`hub starters build`, init.test.ts).
const root = defaultRoot();
const ls = spawnSync("git", ["-C", root, "ls-files"], { encoding: "utf8" });
const inRepo = ls.status === 0;
const tracked = inRepo ? ls.stdout.split("\n").filter(Boolean) : [];

describe.skipIf(!inRepo)("the public core tracks no owner data", () => {
  it("no path of a project other than app/projects/_template, no instance folder, state, database, env or key file", () => {
    expect(pathLeaks(tracked, "core")).toEqual([]);
  });
  it("no tracked text file outside test fixtures holds a token shape", () => {
    const leaks = tracked.filter((f) => TEXT_FILE.test(f)).flatMap((f) => {
      const abs = path.join(root, f);
      try { if (!statSync(abs).isFile() || statSync(abs).size > 2_000_000) return []; } catch { return []; }
      return textLeaks(f, readFileSync(abs, "utf8"));
    });
    expect(leaks).toEqual([]);
  });
});

describe("the leak guard itself", () => {
  it("names each kind of leak and lets the template, fixtures and examples through", () => {
    const core = pathLeaks([
      "app/projects/_template/project.md", "app/projects/acme/project.md", "@docs/custom/notes.md", "@dev/x/PLAN.md", "@refs/a.pdf",
      "state/secrets/notion-token", "state/.gitkeep", "data/app.db", "x/.env", "x/.env.example", "projects/acme/reports/r.md", "README.md",
    ], "core").map((l) => l.file);
    expect(core).toEqual(["app/projects/acme/project.md", "@docs/custom/notes.md", "@dev/x/PLAN.md", "@refs/a.pdf", "state/secrets/notion-token", "data/app.db", "x/.env", "projects/acme/reports/r.md"]);
    const starter = pathLeaks(["projects/my/knowledge/files/.gitkeep", "projects/my/knowledge/files/prices.md", "projects/my/knowledge/taxonomy.md", "@dev/README.md"], "starter").map((l) => l.file);
    expect(starter).toEqual(["projects/my/knowledge/files/prices.md"]);
    const fake = `ntn_${"a".repeat(40)}`;
    expect(textLeaks("docs/x.md", `token ${fake}`)).toHaveLength(1);
    expect(textLeaks("app/x/test/a.test.ts", fake)).toEqual([]);
    expect(textLeaks("docs/x.md", "-----BEGIN OPENSSH PRIVATE KEY-----")).toHaveLength(1);
    expect(textLeaks("docs/x.md", "mail hello@example.com, ids 1234567890")).toEqual([]);
  });
});
