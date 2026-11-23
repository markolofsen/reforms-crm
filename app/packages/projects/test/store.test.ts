import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { projectStore } from "../src/store";
import { setSendPolicy } from "../src/send-policy";
import { projectStoreOf } from "../src/testing";

// P126 P3: one store reads every project's config from project.md, with its send policy when it knows `stateProjects`.

const copy = () => {
  const home = mkdtempSync(path.join(tmpdir(), "hub-store-"));
  cpSync(path.join(__dirname, "fixtures", "projects"), path.join(home, "projects"), { recursive: true });
  return { projects: path.join(home, "projects"), stateProjects: path.join(home, "state-projects") };
};

describe("projectStore", () => {
  it("lists the project folders, skipping the archive", () => {
    expect(projectStore(copy()).list().map((p) => p.slug)).toEqual(["acme-travel", "nordhaus"]);
  });

  it("config applies the send policy only when the store knows where it lives", () => {
    const dirs = copy();
    setSendPolicy(dirs.stateProjects, "acme-travel", projectStore(dirs).config("acme-travel").kind, { "draft.recipients": "any" }, "test");
    expect(projectStore(dirs).config("acme-travel").draft.recipients).toBe("any");
    expect(projectStore({ projects: dirs.projects }).config("acme-travel").draft.recipients).toBe("test");
  });

  it("reads an edit at the next call (no snapshot), and reuses the parse while the file is unchanged", () => {
    const dirs = copy();
    const store = projectStore({ projects: dirs.projects });
    const first = store.file("acme-travel");
    expect(store.file("acme-travel").parsed).toBe(first.parsed);
    const file = path.join(dirs.projects, "acme-travel", "project.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("| name | Acme Travel |", "| name | Renamed Travel |"));
    const after = store.file("acme-travel");
    expect(after.hash).not.toBe(first.hash);
    expect(after.parsed.name).toBe("Renamed Travel");
  });

  it("find is null for a missing, template or hidden project; config and file throw", () => {
    const store = projectStore(copy());
    for (const slug of ["nope", "_archive", ".git"]) expect(store.find(slug)).toBeNull();
    expect(() => store.config("nope")).toThrow(/no such project "nope"/);
    expect(() => store.file("_archive")).toThrow(/no such project/);
  });
});

describe("projectStoreOf (tests)", () => {
  it("reads the record at each call and holds no files", () => {
    const configs: Record<string, Record<string, unknown>> = {};
    const store = projectStoreOf(configs);
    expect(store.find("p")).toBeNull();
    configs.p = { mail: { accounts: ["Work"], addresses: [] } };
    expect(store.config("p").mail.accounts).toEqual(["Work"]);
    expect(store.list()).toEqual([]);
  });
});
