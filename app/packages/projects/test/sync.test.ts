import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkDraftRecipients,
  doctorFailed,
  doctorProject,
  loadProject,
  loadProjects,
  parseProjectMd,
  registryFromDb,
  registryFromLoaded,
  resolveProject,
  syncProjects,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "fixtures", "projects");

let handle: DbHandle;
let repos: Repos;
const dirs: string[] = [];
beforeEach(() => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
});
afterEach(() => {
  handle.close();
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

const copyRoot = () => {
  const root = mkdtempSync(join(tmpdir(), "hub-root-"));
  dirs.push(root);
  cpSync(fixtureRoot, root, { recursive: true });
  return root;
};

describe("loadProjects", () => {
  it("skips the archive and reads folder names as slugs", () => {
    expect(loadProjects(fixtureRoot).map((p) => p.slug)).toEqual(["acme-travel", "nordhaus"]);
  });
});

describe("syncProjects", () => {
  it("writes projects and addresses in one go; a shared account is allowed", async () => {
    const r = await syncProjects(repos, loadProjects(fixtureRoot), "2026-11-20T10:00:00.000Z");
    expect(r).toMatchObject({ ok: true, projects: 2 });
    const reg = await repos.projects.registry();
    expect(reg.projects.map((p) => [p.slug, p.status, p.syncedAt])).toEqual([
      ["acme-travel", "active", "2026-11-20T10:00:00.000Z"],
      ["nordhaus", "active", "2026-11-20T10:00:00.000Z"],
    ]);
    expect(reg.addresses.filter((a) => a.kind === "account")).toHaveLength(2);
    expect(reg.addresses.filter((a) => a.kind === "address").map((a) => a.address).sort()).toEqual([
      "hello@acme.example",
      "office@nordhaus.example",
      "owner@acme.example",
    ]);
  });

  it("stores the kind and the archived flag, derived from the files", async () => {
    const root = copyRoot();
    const nord = loadProject(root, "nordhaus");
    const fs = await import("node:fs");
    fs.writeFileSync(nord.file, fs.readFileSync(nord.file, "utf8").replace("| status | active |", "| status | archived |").replace("| schema | 1 | 2026-11-14 | agent |", "| schema | 1 | 2026-11-14 | agent |\n| kind | shop | 2026-11-15 | agent |"));
    const r = await syncProjects(repos, loadProjects(root));
    expect(r.ok).toBe(true);
    const reg = (await repos.projects.registry()).projects;
    expect(reg.map((p) => [p.slug, p.kind, p.archived])).toEqual([["acme-travel", "generic", false], ["nordhaus", "shop", true]]);
    // an archived project routes like a paused one: nothing runs
    expect(resolveProject({ account: "x", recipients: ["office@nordhaus.example"] }, await registryFromDb(repos))).toEqual({ outcome: "inactive", project: "nordhaus", status: "archived" });
  });

  it("registryFromDb refuses a row from an older schema instead of guessing", async () => {
    await repos.projects.replaceRegistry({ projects: [{ slug: "old", name: "old", status: "active", settingsJson: JSON.stringify({ slug: "old", mail: { accounts: [] } }), hash: "h" }], addresses: [] });
    await expect(registryFromDb(repos)).rejects.toThrow();
  });

  it("is idempotent and the router reads the same answer from files and from the index", async () => {
    const loaded = loadProjects(fixtureRoot);
    await syncProjects(repos, loaded);
    await syncProjects(repos, loaded);
    expect((await repos.projects.registry()).projects).toHaveLength(2);
    const fromDb = await registryFromDb(repos);
    expect(fromDb).toEqual(registryFromLoaded(loaded));
    expect(resolveProject({ account: "owner@acme.example", recipients: ["office@nordhaus.example"] }, fromDb)).toEqual({ outcome: "project", project: "nordhaus" });
  });

  it("a duplicate address claim fails the whole sync and keeps the old index", async () => {
    await syncProjects(repos, loadProjects(fixtureRoot));
    const root = copyRoot();
    const nord = loadProject(root, "nordhaus");
    // make nordhaus also claim hello@acme.example
    const text = (await import("node:fs")).readFileSync(nord.file, "utf8").replace("office@nordhaus.example", "office@nordhaus.example, hello@acme.example");
    (await import("node:fs")).writeFileSync(nord.file, text);
    const r = await syncProjects(repos, loadProjects(root));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/duplicate_claim: address hello@acme.example is claimed by acme-travel and nordhaus/);
    expect((await repos.projects.registry()).projects).toHaveLength(2);
  });

  it("a project with an error stops the sync", async () => {
    const root = copyRoot();
    mkdirSync(join(root, "broken"));
    (await import("node:fs")).writeFileSync(join(root, "broken", "project.md"), "# broken\n\n## Settings\n\n| Field | Value | Answered | By |\n|---|---|---|---|\n| schema | 7 | 2026-11-14 | agent |\n");
    const r = await syncProjects(repos, loadProjects(root));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/broken: error: unknown_schema/);
    expect(await repos.projects.get("acme-travel")).toBeNull();
  });
});

describe("checkDraftRecipients", () => {
  const cfg = (r: "test" | "any" | string[]) => ({ draft: { recipients: r } });
  it("test means the global allow list", () => {
    expect(checkDraftRecipients(cfg("test"), ["Me@Mine.example"], ["me@mine.example"])).toEqual({ ok: true });
    expect(checkDraftRecipients(cfg("test"), ["me@mine.example", "client@x.example"], ["me@mine.example"])).toEqual({ ok: false, blocked: ["client@x.example"] });
  });
  it("any lets everything through, a list only its members", () => {
    expect(checkDraftRecipients(cfg("any"), ["a@b.example"], [])).toEqual({ ok: true });
    expect(checkDraftRecipients(cfg(["a@b.example"]), ["a+x@b.example"], ["other@x.example"])).toEqual({ ok: true });
    expect(checkDraftRecipients(cfg(["a@b.example"]), ["c@b.example"], [])).toEqual({ ok: false, blocked: ["c@b.example"] });
  });
});

describe("doctorProject", () => {
  const all = () => loadProjects(fixtureRoot);
  const acme = () => all().find((p) => p.slug === "acme-travel")!;
  const names = (cs: { name: string; outcome: string }[]) => Object.fromEntries(cs.map((c) => [c.name, c.outcome]));

  it("lists each check by name", async () => {
    const cs = await doctorProject({
      project: acme(),
      all: all(),
      mailAccounts: ["owner@acme.example"],
      notionCheck: async () => ({ ok: true, detail: "2 databases read" }),
      knowledgeFiles: 3,
      knowledgeDocs: 3,
      mcpMailAccounts: ["owner@acme.example"],
    });
    expect(doctorFailed(cs)).toBe(false);
    expect(names(cs)).toEqual({
      "project.md parses": "pass",
      "kind is known": "pass",
      "mail accounts exist": "pass",
      "sender is one of the addresses": "pass",
      "send settings": "pass",
      "no address claimed twice": "pass",
      "active project has an address": "pass",
      "notion databases readable": "pass",
      "knowledge index not empty": "pass",
      "mail MCP limited to the project's accounts": "pass",
    });
  });

  it("fails by name: missing account, unreadable notion, empty index, wide allow-list", async () => {
    const cs = await doctorProject({
      project: acme(),
      all: all(),
      mailAccounts: ["someone@else.example"],
      notionCheck: async () => {
        throw new Error("401 unauthorized");
      },
      knowledgeFiles: 3,
      knowledgeDocs: 0,
      mcpMailAccounts: ["owner@acme.example", "someone@else.example"],
    });
    expect(names(cs)).toMatchObject({
      "mail accounts exist": "fail",
      "notion databases readable": "fail",
      "knowledge index not empty": "fail",
      "mail MCP limited to the project's accounts": "fail",
    });
    expect(cs.find((c) => c.name === "notion databases readable")?.detail).toMatch(/401/);
  });

  it("a sender outside the addresses and a claimed-twice address fail", async () => {
    const root = copyRoot();
    const fs = await import("node:fs");
    const f = join(root, "acme-travel", "project.md");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("| mail.sender | hello@acme.example |", "| mail.sender | ceo@acme.example |"));
    const nf = join(root, "nordhaus", "project.md");
    fs.writeFileSync(nf, fs.readFileSync(nf, "utf8").replace("office@nordhaus.example", "hello@acme.example"));
    const loaded = loadProjects(root);
    const cs = await doctorProject({ project: loaded.find((p) => p.slug === "acme-travel")!, all: loaded });
    expect(names(cs)).toMatchObject({ "sender is one of the addresses": "fail", "no address claimed twice": "fail", "mail accounts exist": "skipped" });
  });

  it("an adopt-mode project parses but has no mail", async () => {
    const p = parseProjectMd(`# x\n\n- clients: 00000000-0000-4000-8000-000000000001\n`, "x");
    const cs = await doctorProject({ project: { slug: "x", folder: "/x", file: "/x/project.md", hash: "", parsed: p }, all: [] });
    expect(names(cs)).toMatchObject({ "project.md parses": "pass", "mail accounts exist": "fail" });
  });
});
