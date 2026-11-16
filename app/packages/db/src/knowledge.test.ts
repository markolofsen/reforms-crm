import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DbHandle } from "./client";
import { RepoError } from "./errors";
import { buildMatchQuery, createRepos, type NewKnowledgeDoc, type Repos } from "./index";

let handle: DbHandle;
let repos: Repos;

const reg = (slug: string, status = "active") => ({ slug, name: slug, status, settingsJson: "{}", hash: slug });

beforeEach(async () => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  await repos.projects.replaceRegistry({ projects: [reg("a"), reg("b")], addresses: [] });
});
afterEach(() => handle.close());

const doc = (o: Partial<NewKnowledgeDoc> & { path: string; title: string }): NewKnowledgeDoc => ({
  use: "STATE",
  approved: true,
  audiences: ["ANY"],
  body: "",
  phrasings: "",
  frontMatter: {},
  contentHash: o.path,
  ...o,
});

const paths = (r: { hits: { path: string }[] }) => r.hits.map((h) => h.path);

describe("knowledge_fts stays in sync", () => {
  it("follows insert, update and delete", async () => {
    await repos.knowledge.upsert("a", doc({ path: "k/one.md", title: "Visa processing time", body: "Usually six weeks." }));
    expect(paths(await repos.knowledge.search("a", "visa"))).toEqual(["k/one.md"]);

    // update: the old words stop matching, the new ones match
    await repos.knowledge.upsert("a", doc({ path: "k/one.md", title: "Passport renewal", body: "Ten days.", contentHash: "2" }));
    expect(paths(await repos.knowledge.search("a", "visa"))).toEqual([]);
    expect(paths(await repos.knowledge.search("a", "passport"))).toEqual(["k/one.md"]);

    // delete (deleteMissing)
    expect(await repos.knowledge.deleteMissing("a", [])).toBe(1);
    expect(paths(await repos.knowledge.search("a", "passport"))).toEqual([]);
    const ftsRows = (handle.db as any).$client.prepare("select count(*) as n from knowledge_fts_docsize").get() as { n: number };
    expect(ftsRows.n).toBe(0);
  });

  it("ranks the title above the body", async () => {
    await repos.knowledge.upsert("a", doc({ path: "body.md", title: "Other", body: "mentions mortgage once" }));
    await repos.knowledge.upsert("a", doc({ path: "title.md", title: "Mortgage rates", body: "plain" }));
    expect(paths(await repos.knowledge.search("a", "mortgage"))[0]).toBe("title.md");
  });

  it("prefix-matches the start of a word", async () => {
    await repos.knowledge.upsert("a", doc({ path: "x.md", title: "Citizenship by investment" }));
    expect(paths(await repos.knowledge.search("a", "citizen"))).toEqual(["x.md"]);
  });
});

describe("project isolation", () => {
  it("never returns another project's row", async () => {
    await repos.knowledge.upsert("a", doc({ path: "k/x.md", title: "Shared word: marina", body: "alpha" }));
    await repos.knowledge.upsert("b", doc({ path: "k/x.md", title: "Shared word: marina", body: "beta" }));
    await repos.knowledge.upsert("b", doc({ path: "k/only-b.md", title: "Marina berths" }));
    const a = await repos.knowledge.search("a", "marina");
    expect(paths(a)).toEqual(["k/x.md"]);
    expect(a.total).toBe(1);
    expect((await repos.knowledge.get("a", "k/x.md"))?.body).toBe("alpha");
    expect(await repos.knowledge.get("a", "k/only-b.md")).toBeNull();
    expect(await repos.knowledge.count("b")).toBe(2);
    expect((await repos.knowledge.search("b", "marina")).total).toBe(2);
  });

  it("deleteMissing touches only its project", async () => {
    await repos.knowledge.upsert("a", doc({ path: "x.md", title: "x" }));
    await repos.knowledge.upsert("b", doc({ path: "x.md", title: "x" }));
    await repos.knowledge.deleteMissing("a", []);
    expect(await repos.knowledge.count("a")).toBe(0);
    expect(await repos.knowledge.count("b")).toBe(1);
  });

  it("expiredCount counts the entries whose valid_until day is before today, per project", async () => {
    await repos.knowledge.upsert("a", doc({ path: "old.md", title: "old", validUntil: "2026-11-01" }));
    await repos.knowledge.upsert("a", doc({ path: "today.md", title: "today", validUntil: "2026-11-15T23:00:00Z" }));
    await repos.knowledge.upsert("a", doc({ path: "none.md", title: "none" }));
    await repos.knowledge.upsert("b", doc({ path: "old.md", title: "old", validUntil: "2026-10-01" }));
    expect(await repos.knowledge.expiredCount("a", "2026-11-15")).toBe(1);
    expect(await repos.knowledge.expiredCount("a", "2026-11-16")).toBe(2);
    expect(await repos.knowledge.expiredCount("b", "2026-11-15")).toBe(1);
  });

  it("throws unknown_project on every function", async () => {
    const calls: Array<() => Promise<unknown>> = [
      () => repos.knowledge.upsert("zzz", doc({ path: "x.md", title: "x" })),
      () => repos.knowledge.deleteMissing("zzz", []),
      () => repos.knowledge.search("zzz", "x"),
      () => repos.knowledge.get("zzz", "x.md"),
      () => repos.knowledge.count("zzz"),
      () => repos.projects.openQuestion("zzz", { field: "f", question: "q" }),
      () => repos.projects.questions("zzz"),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ code: "unknown_project" });
    }
    await expect(repos.knowledge.count("zzz")).rejects.toBeInstanceOf(RepoError);
  });
});

describe("tokenizer", () => {
  it("matches Cyrillic regardless of case", async () => {
    await repos.knowledge.upsert("a", doc({ path: "ru.md", title: "Срок оформления визы", body: "Обычно шесть недель." }));
    expect(paths(await repos.knowledge.search("a", "ВИЗЫ"))).toEqual(["ru.md"]);
    expect(paths(await repos.knowledge.search("a", "недел"))).toEqual(["ru.md"]);
  });

  it("folds diacritics both ways", async () => {
    await repos.knowledge.upsert("a", doc({ path: "de.md", title: "Grundsteuer für Wohnungen", body: "Café nähe Küste" }));
    expect(paths(await repos.knowledge.search("a", "fur"))).toEqual(["de.md"]);
    expect(paths(await repos.knowledge.search("a", "cafe"))).toEqual(["de.md"]);
    expect(paths(await repos.knowledge.search("a", "küste"))).toEqual(["de.md"]);
    expect(paths(await repos.knowledge.search("a", "kuste"))).toEqual(["de.md"]);
  });

  it("searches phrasings, which carry the client's own words", async () => {
    await repos.knowledge.upsert("a", doc({ path: "p.md", title: "Processing time", phrasings: "how long until my papers are ready" }));
    expect(paths(await repos.knowledge.search("a", "papers ready"))).toEqual(["p.md"]);
  });
});

describe("hostile query text", () => {
  it.each(['" OR *', "NEAR(a b)", "title:secret", '"unterminated', "a AND NOT b", "*", "(((", "'; drop table x; --"])(
    "does not throw on %s",
    async (q) => {
      await repos.knowledge.upsert("a", doc({ path: "x.md", title: "secret a b" }));
      const res = await repos.knowledge.search("a", q).catch((e: unknown) => e);
      // Either a result or the typed empty_query refusal; never an FTS syntax error.
      if (res instanceof Error) expect((res as RepoError).code).toBe("empty_query");
      else expect(res).toHaveProperty("total");
    },
  );

  it("refuses a query with no word", async () => {
    await expect(repos.knowledge.search("a", "  *** ")).rejects.toMatchObject({ code: "empty_query" });
  });

  it("builds quoted prefix terms joined by OR", () => {
    expect(buildMatchQuery('Visa, "time"!')).toBe('"visa"* OR "time"*');
    expect(buildMatchQuery("a")).toBe('"a"*');
    expect(buildMatchQuery("a visa")).toBe('"visa"*');
    expect(buildMatchQuery("")).toBeNull();
  });
});

describe("filters", () => {
  beforeEach(async () => {
    await repos.knowledge.upsert("a", doc({ path: "ok.md", title: "Fee schedule", audiences: ["CLIENT"] }));
    await repos.knowledge.upsert("a", doc({ path: "any.md", title: "Fee for everyone", audiences: ["ANY"] }));
    await repos.knowledge.upsert("a", doc({ path: "none.md", title: "Fee internal", audiences: [] }));
    await repos.knowledge.upsert("a", doc({ path: "draft.md", title: "Fee draft", approved: false, audiences: ["ANY"] }));
    await repos.knowledge.upsert("a", doc({ path: "old.md", title: "Fee old", validUntil: "2026-01-01", audiences: ["ANY"] }));
    await repos.knowledge.upsert("a", doc({ path: "today.md", title: "Fee today", validUntil: "2026-11-14", audiences: ["ANY"] }));
  });
  const q = { today: "2026-11-14" };

  it("drops unapproved and expired by default; valid_until today is still valid", async () => {
    expect(paths(await repos.knowledge.search("a", "fee", q)).sort()).toEqual(["any.md", "none.md", "ok.md", "today.md"]);
  });

  it("include=all returns them flagged", async () => {
    const r = await repos.knowledge.search("a", "fee", { ...q, include: "all" });
    const by = Object.fromEntries(r.hits.map((h) => [h.path, h]));
    expect(by["draft.md"]?.approved).toBe(false);
    expect(by["old.md"]?.expired).toBe(true);
    expect(by["ok.md"]?.expired).toBe(false);
    expect(r.total).toBe(6);
  });

  it("audience matches the listed audience and ANY; an empty list matches no filtered search", async () => {
    expect(paths(await repos.knowledge.search("a", "fee", { ...q, audience: "CLIENT" })).sort()).toEqual(["any.md", "ok.md", "today.md"]);
    expect(paths(await repos.knowledge.search("a", "fee", { ...q, audience: "LAWYER" })).sort()).toEqual(["any.md", "today.md"]);
    // unfiltered search still sees the entry with no audiences
    expect(paths(await repos.knowledge.search("a", "fee", q))).toContain("none.md");
  });

  it("limits to 1..10 and reports the total", async () => {
    const r = await repos.knowledge.search("a", "fee", { ...q, limit: 2 });
    expect(r.hits).toHaveLength(2);
    expect(r.total).toBe(4);
    expect((await repos.knowledge.search("a", "fee", { ...q, limit: 99 })).hits.length).toBeLessThanOrEqual(10);
  });
});

describe("registry and questions", () => {
  it("replaces the registry in one transaction and keeps questions", async () => {
    await repos.projects.openQuestion("a", { field: "tone", question: "Tone?" });
    await repos.projects.replaceRegistry({
      projects: [reg("a")],
      addresses: [{ address: "x@a.example", project: "a", kind: "address" }],
    });
    expect((await repos.projects.registry()).projects.map((p) => p.slug)).toEqual(["a"]);
    expect(await repos.projects.questions("a", "open")).toHaveLength(1);
  });

  it("a duplicate address claim is a hard error and leaves the old registry intact", async () => {
    await expect(
      repos.projects.replaceRegistry({
        projects: [reg("a"), reg("b")],
        addresses: [
          { address: "x@x.example", project: "a", kind: "address" },
          { address: "x@x.example", project: "b", kind: "address" },
        ],
      }),
    ).rejects.toMatchObject({ code: "duplicate_claim" });
    expect((await repos.projects.registry()).projects.map((p) => p.slug)).toEqual(["a", "b"]);
  });

  it("an account may be shared by two projects", async () => {
    await repos.projects.replaceRegistry({
      projects: [reg("a"), reg("b")],
      addresses: [
        { address: "shared@x.example", project: "a", kind: "account" },
        { address: "shared@x.example", project: "b", kind: "account" },
      ],
    });
    expect((await repos.projects.registry()).addresses).toHaveLength(2);
  });

  it("keeps one open question per project", async () => {
    const first = await repos.projects.openQuestion("a", { field: "tone", question: "Tone?", options: ["warm", "brief"] });
    const second = await repos.projects.openQuestion("a", { field: "signoff", question: "Sign-off?" });
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    await repos.projects.openQuestion("b", { field: "tone", question: "Tone?" });
    expect(await repos.projects.openQuestionCount()).toBe(2);
    expect(await repos.projects.answerQuestion("a", "warm")).toBe(true);
    expect(await repos.projects.answerQuestion("a", "again")).toBe(false);
    const next = await repos.projects.openQuestion("a", { field: "signoff", question: "Sign-off?" });
    expect(next.created).toBe(true);
  });

  it("list() still reports projects that only exist in old rows", async () => {
    await repos.clients.create({ project: "old", email: "x@y.z", name: "X" });
    expect(await repos.projects.list()).toEqual(["a", "b", "old"]);
  });
});

describe("migrations", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hub-db-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("applies on a fresh file and is idempotent", () => {
    const file = join(dir, "fresh.db");
    openDb(file).close();
    const again = openDb(file);
    const tables = (again.db as any).$client
      .prepare("select name from sqlite_master where name in ('projects','project_addresses','project_questions','knowledge_docs','knowledge_fts') order by name")
      .all();
    again.close();
    expect(tables).toHaveLength(5);
  });

  it("applies on an existing app.db that only has migration 0000, keeping its rows", async () => {
    const here = join(import.meta.dirname, "..", "drizzle");
    const old = join(dir, "old-migrations");
    mkdirSync(join(old, "meta"), { recursive: true });
    cpSync(join(here, "0000_whole_carnage.sql"), join(old, "0000_whole_carnage.sql"));
    cpSync(join(here, "meta", "0000_snapshot.json"), join(old, "meta", "0000_snapshot.json"));
    const journal = JSON.parse(readFileSync(join(here, "meta", "_journal.json"), "utf8")) as { entries: unknown[] };
    writeFileSync(join(old, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }));

    const file = join(dir, "app.db");
    const raw = new Database(file);
    migrate(drizzle(raw), { migrationsFolder: old });
    raw.prepare("insert into clients (project, email, name) values ('acme', 'old@x.example', 'Old')").run();
    raw.close();

    const upgraded = openDb(file);
    const r = createRepos(upgraded.db);
    expect(await r.clients.listAll("acme")).toHaveLength(1);
    await r.projects.replaceRegistry({ projects: [reg("acme")], addresses: [] });
    await r.knowledge.upsert("acme", doc({ path: "x.md", title: "Hello world" }));
    expect((await r.knowledge.search("acme", "hello")).total).toBe(1);
    upgraded.close();
  });
});
