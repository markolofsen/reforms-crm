import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle } from "@hub/db";
import { projectOverview } from "./overview";

let handle: DbHandle;
beforeEach(() => {
  handle = openDb(":memory:");
});
afterEach(() => handle.close());

describe("projectOverview", () => {
  it("says what is missing instead of failing: no registry row, no knowledge, no filters", async () => {
    const root = mkdtempSync(join(tmpdir(), "hub-overview-"));
    mkdirSync(join(root, "demo"));
    const o = await projectOverview(createRepos(handle.db), "demo", root);
    expect(o.project).toBeNull();
    expect(o.question).toBeNull();
    expect(o.knowledge).toEqual({ state: "absent" });
    expect(o.filters).toEqual({ state: "absent" });
  });

  it("counts the rules of a mail-filters file and reports a broken row as an issue, not an error", async () => {
    const root = mkdtempSync(join(tmpdir(), "hub-overview-"));
    mkdirSync(join(root, "demo"));
    writeFileSync(join(root, "demo", "mail-filters.md"), "# Mail filters\n\n## Rules\n\n| match | category | label | action | why | date | by |\n|---|---|---|---|---|---|---|\n| nonsense | x | y | z | w | d | b |\n");
    const o = await projectOverview(createRepos(handle.db), "demo", root);
    expect(o.filters.state).toBe("ok");
    if (o.filters.state === "ok") {
      expect(o.filters.rules).toBe(0);
      expect(o.filters.issues.length).toBeGreaterThan(0);
    }
  });
});
