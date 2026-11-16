import { createRepos, openDb } from "@hub/db";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProjects, registryFromDb, renameProject, rewriteProjectMd, rewriteSlugTokens, syncProjects } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const Database = function (file: string, _o?: unknown) { return openDb(file).db.$client; } as unknown as new (file: string, o?: unknown) => ReturnType<typeof openDb>["db"]["$client"];
let dir: string;
let projects: string;
let state: string;
let dbPath: string;

const opts = (apply: boolean, from = "acme-travel", to = "travel-desk") => ({ projectsRoot: projects, stateRoot: state, dbPath, from, to, apply, now: new Date("2026-11-15T10:15:30Z") });
const rowsOf = (sql: string) => {
  const d = new Database(dbPath, { readonly: true });
  try { return d.prepare(sql).all() as Array<Record<string, unknown>>; } finally { d.close(); }
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "hub-rename-"));
  projects = join(dir, "app", "projects");
  state = join(dir, "state");
  dbPath = join(dir, "app", "data", "app.db");
  cpSync(join(here, "fixtures", "projects"), projects, { recursive: true });
  const md = join(projects, "acme-travel", "project.md");
  writeFileSync(md, readFileSync(md, "utf8").replace(/^# .*$/m, "# acme-travel"));
  mkdirSync(join(projects, "acme-travel", ".generated"), { recursive: true });
  writeFileSync(join(projects, "acme-travel", ".generated", "f.xml"), "<id>tag:mail.google.com,2008:filters:hub-acme-travel</id>\n");
  mkdirSync(join(state, "projects", "acme-travel"), { recursive: true });
  mkdirSync(join(state, "projects", "nordhaus"), { recursive: true });
  writeFileSync(join(state, "projects", "acme-travel", "mcp.json"), '{"env": {"HUB_PROJECT": "acme-travel"}}\n');
  writeFileSync(join(state, "projects", "nordhaus", "settings.json"), '{"deny":["Read(./app/projects/acme-travel/**)"]}\n');
  writeFileSync(join(state, "projects", "binding.json"), '{"project":"acme-travel","at":"x"}\n');
  const h = openDb(dbPath);
  const repos = createRepos(h.db);
  expect((await syncProjects(repos, loadProjects(projects))).ok).toBe(true);
  h.db.$client.exec(`insert into clients (project, email, name) values ('acme-travel','a@example.com','A'), ('nordhaus','n@example.com','N');
    insert into knowledge_docs (project, path, title, body, content_hash) values ('acme-travel','k.md','Visa rules','the visa takes ten days','h1');
    insert into project_questions (project, field, question, asked_at) values ('acme-travel','tone','How?','2026-11-15');`);
  h.close();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("project rename", () => {
  it("is a dry run by default: reports every place, changes nothing", () => {
    const r = renameProject(opts(false));
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(false);
    expect(r.db.tables.map((t) => t.table).sort()).toEqual(["client_identifiers", "clients", "knowledge_docs", "project_addresses", "project_questions", "projects"].filter((t) => r.db.tables.some((x) => x.table === t)));
    expect(r.db.total).toBeGreaterThanOrEqual(4);
    expect(existsSync(join(projects, "acme-travel"))).toBe(true);
    expect(existsSync(join(projects, "travel-desk"))).toBe(false);
    expect(rowsOf("select count(*) n from clients where project = 'acme-travel'")[0]!.n).toBe(1);
    expect(readdirSync(join(dir, "app", "data")).filter((f) => f.includes("before-rename"))).toEqual([]);
  });

  it("moves folder, project.md, every project column, registry, state files and binding, after a backup", async () => {
    const r = renameProject(opts(true));
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(true);
    expect(existsSync(join(projects, "acme-travel"))).toBe(false);
    const md = readFileSync(join(projects, "travel-desk", "project.md"), "utf8");
    expect(md).toMatch(/^# travel-desk$/m);
    expect(readFileSync(join(projects, "travel-desk", ".generated", "f.xml"), "utf8")).toContain("filters:hub-travel-desk");
    expect(readFileSync(join(state, "projects", "travel-desk", "mcp.json"), "utf8")).toContain('"HUB_PROJECT": "travel-desk"');
    expect(readFileSync(join(state, "projects", "nordhaus", "settings.json"), "utf8")).toContain("app/projects/travel-desk/**");
    expect(JSON.parse(readFileSync(join(state, "projects", "binding.json"), "utf8")).project).toBe("travel-desk");
    // the backup is a full copy of the OLD data
    const backup = readdirSync(join(dir, "app", "data")).find((f) => f.startsWith("app.db.before-rename-acme-travel-20261115T101530Z"));
    expect(backup).toBeTruthy();
    const old = new Database(join(dir, "app", "data", backup!), { readonly: true });
    expect((old.prepare("select count(*) n from clients where project = 'acme-travel'").get() as { n: number }).n).toBe(1);
    old.close();
    // no table keeps the old slug; the other project is untouched
    for (const t of ["clients", "knowledge_docs", "project_questions", "project_addresses"]) {
      expect(rowsOf(`select count(*) n from ${t} where project = 'acme-travel'`)[0]!.n, t).toBe(0);
    }
    expect(rowsOf("select count(*) n from clients where project = 'nordhaus'")[0]!.n).toBe(1);
    expect(rowsOf("select count(*) n from clients where project = 'travel-desk'")[0]!.n).toBe(1);
    // the registry row reads back and agrees with the folder
    const h = openDb(dbPath);
    const reg = await registryFromDb(createRepos(h.db));
    h.close();
    expect(reg.map((p) => p.slug)).toContain("travel-desk");
    expect(reg.map((p) => p.slug)).not.toContain("acme-travel");
    expect(loadProjects(projects).map((p) => p.slug)).toContain("travel-desk");
    // FTS follows the update
    expect(rowsOf("select count(*) n from knowledge_fts where knowledge_fts match 'visa'")[0]!.n).toBe(1);
  });

  it("refuses a taken target, a missing source and a bad slug, writing nothing", () => {
    expect(renameProject(opts(true, "acme-travel", "nordhaus")).problems[0]).toMatch(/already exists/);
    expect(renameProject(opts(true, "ghost", "x-y")).problems[0]).toMatch(/no project/);
    expect(renameProject(opts(true, "acme-travel", "Bad Slug")).ok).toBe(false);
    expect(renameProject(opts(true, "acme-travel", "_hidden")).ok).toBe(false);
    expect(existsSync(join(projects, "acme-travel"))).toBe(true);
  });

  it("refuses when the database already holds rows for the new slug", () => {
    const d = new Database(dbPath);
    d.exec("insert into clients (project, email, name) values ('travel-desk','z@example.com','Z')");
    d.close();
    const r = renameProject(opts(true));
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/already has rows/);
    expect(existsSync(join(projects, "acme-travel"))).toBe(true);
  });

  it("restores the files when the database write fails", () => {
    const d = new Database(dbPath);
    // a trigger that refuses the update makes the transaction fail after the files moved
    d.exec("create trigger refuse before update on clients begin select raise(abort, 'no'); end");
    d.close();
    const r = renameProject(opts(true));
    expect(r.ok).toBe(false);
    expect(existsSync(join(projects, "acme-travel", "project.md"))).toBe(true);
    expect(existsSync(join(projects, "travel-desk"))).toBe(false);
    expect(readFileSync(join(projects, "acme-travel", ".generated", "f.xml"), "utf8")).toContain("hub-acme-travel");
    expect(JSON.parse(readFileSync(join(state, "projects", "binding.json"), "utf8")).project).toBe("acme-travel");
    expect(rowsOf("select count(*) n from clients where project = 'acme-travel'")[0]!.n).toBe(1);
  });

  it("rewrites only literal references, never prose", () => {
    expect(rewriteSlugTokens("see app/projects/old/x and app/projects/older/y", "old", "new")).toBe("see app/projects/new/x and app/projects/older/y");
    expect(rewriteProjectMd("# old\n\nthe old project\n| name | old | 2026-01-01 | owner |\n| name2 | old | | |", "old", "new")).toBe("# new\n\nthe old project\n| name | new | 2026-01-01 | owner |\n| name2 | old | | |");
  });
});

describe("PROJECT.json", () => {
  it("is written per project on sync: kind, modules, skills, mail classes, resolved config, missing required fields", async () => {
    const { writeProjectJson, projectJson } = await import("../src/index.js");
    const all = loadProjects(projects);
    const files = writeProjectJson(all);
    expect(files.length).toBe(all.length);
    const acme = JSON.parse(readFileSync(join(projects, "acme-travel", ".generated", "PROJECT.json"), "utf8"));
    expect(acme.kind).toBe("generic");
    expect(acme.skills).toContain("triage-mail");
    expect(acme.mailClasses.map((c: { id: string }) => c.id)).toContain("client");
    expect(acme.config.slug).toBe("acme-travel");
    expect(Array.isArray(acme.missing)).toBe(true);
    expect(projectJson(all[0]!).schema).toBe(1);
  });
});
