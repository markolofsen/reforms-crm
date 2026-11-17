import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { restoreCheck } from "./backup-check";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../drizzle");

/** A migrations folder holding only the first `n` entries of the journal. */
function folderUpTo(n: number): string {
  const dir = mkdtempSync(join(tmpdir(), "hub-mig-"));
  mkdirSync(join(dir, "meta"));
  const journal = JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
  const entries = journal.entries.slice(0, n);
  for (const e of entries) cpSync(join(source, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
  return dir;
}

describe("migration 0006 (record-draft)", () => {
  it("drops company and value_eur, adds updated_at and notion_url, and keeps rows and foreign keys", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: folderUpTo(6) }); // 0000 .. 0005

    sqlite.prepare("insert into clients (project, email, name, company, value_eur, replies_owed, created_at) values ('p','a@x.example','A','Acme',500,1,'2026-11-01T00:00:00.000Z')").run();
    sqlite.prepare("insert into marks (project, client_id, mark) values ('p',1,'vip')").run();
    sqlite.prepare("insert into drafts (project, client_id, subject, to_addr, body) values ('p',1,'s','a@x.example','b')").run();

    migrate(db, { migrationsFolder: source }); // + 0006

    const cols = (t: string) => (sqlite.prepare(`pragma table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols("clients")).not.toContain("company");
    expect(cols("clients")).not.toContain("value_eur");
    expect(cols("clients")).toContain("updated_at");
    expect(cols("drafts")).toContain("notion_url");

    expect(sqlite.prepare("select email, name, replies_owed, updated_at, created_at from clients").get()).toMatchObject({ email: "a@x.example", name: "A", replies_owed: 1, updated_at: "2026-11-01T00:00:00.000Z" });
    expect(sqlite.prepare("select count(*) as n from marks").get()).toEqual({ n: 1 });
    expect(sqlite.prepare("select count(*) as n from drafts").get()).toEqual({ n: 1 });
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
  });
});

describe("migrations 0010 to 0013 on a populated database", () => {
  it("keep every client, draft and batch, add the inbox, evidence and hash columns, and drop the template columns", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: folderUpTo(10) }); // 0000 .. 0009: the shape every live database has today

    sqlite.prepare("insert into clients (project, email, name, replies_owed, created_at) values ('p','a@x.example','A',1,'2026-11-01T00:00:00.000Z')").run();
    sqlite.prepare("insert into batches (project, name, intent, mode, audience, total, subject_template, body_template) values ('p','old','follow_up','template','all',1,'Hi','Hello {{first_name}}')").run();
    sqlite.prepare("insert into drafts (project, client_id, batch_id, subject, to_addr, body, checked) values ('p',1,1,'s','a@x.example','Hello A',1)").run();

    migrate(db, { migrationsFolder: source }); // 0010 .. 0013, as `hub up` does when the server opens the database

    const cols = (t: string) => (sqlite.prepare(`pragma table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols("batches")).not.toContain("mode");
    expect(cols("batches")).not.toContain("subject_template");
    expect(cols("batches")).not.toContain("body_template");
    expect(cols("drafts")).toEqual(expect.arrayContaining(["evidence", "evidence_source", "evidence_findings", "context", "checked_hash"]));
    expect(cols("inbox_rows")).toContain("notion_kind");
    expect(sqlite.prepare("select name, intent from batches").get()).toEqual({ name: "old", intent: "follow_up" });
    expect(sqlite.prepare("select body, checked, checked_hash from drafts").get()).toEqual({ body: "Hello A", checked: 1, checked_hash: null });
    expect(sqlite.prepare("select count(*) as n from clients").get()).toEqual({ n: 1 });
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(sqlite.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    sqlite.close();
  });
});

describe("migration 0014 (redundant indexes)", () => {
  const indexes = (sqlite: Database.Database, table: string) => (sqlite.prepare(`pragma index_list(${table})`).all() as { name: string }[]).map((i) => i.name);
  it("drops the two indexes that are a prefix of a unique index and keeps the unique ones", () => {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: folderUpTo(14) }); // 0000 .. 0013
    expect(indexes(sqlite, "clients")).toContain("clients_project");
    expect(indexes(sqlite, "project_addresses")).toContain("project_addresses_project");
    migrate(db, { migrationsFolder: source });
    expect(indexes(sqlite, "clients")).not.toContain("clients_project");
    expect(indexes(sqlite, "clients")).toContain("clients_project_email");
    expect(indexes(sqlite, "project_addresses")).not.toContain("project_addresses_project");
    expect(indexes(sqlite, "project_addresses")).toContain("project_addresses_claim");
    sqlite.close();
  });
});

describe("restoreCheck", () => {
  it("opens a snapshot made by an OLDER core, applies the newer migrations and loses no row", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hub-restore-"));
    const old = join(tmp, "old.db");
    const sqlite = new Database(old);
    sqlite.pragma("foreign_keys = ON");
    migrate(drizzle(sqlite), { migrationsFolder: folderUpTo(14) }); // a core that ended at 0013
    sqlite.prepare("insert into clients (project, email, name, replies_owed, created_at) values ('p','a@x.example','A',1,'2026-11-01T00:00:00.000Z')").run();
    sqlite.close();
    const work = mkdtempSync(join(tmpdir(), "hub-restore-work-"));
    const r = restoreCheck(old, work);
    expect(r.before.integrity).toBe("ok");
    expect(r.after.integrity).toBe("ok");
    expect(r.migrationsApplied).toBeGreaterThanOrEqual(1);
    expect(r.after.dataRows).toBe(r.before.dataRows);
    expect(r.after.dataRows).toBeGreaterThanOrEqual(1);
    expect(r.after.rows).toBe(r.before.rows + r.migrationsApplied);
  });
  it("reports a file that is not a database instead of throwing past the integrity result", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hub-restore-"));
    const bad = join(tmp, "bad.db");
    writeFileSync(bad, "not a database at all, just text that is long enough to look like a header ".repeat(4));
    expect(() => restoreCheck(bad, tmp)).toThrow();
  });
});
