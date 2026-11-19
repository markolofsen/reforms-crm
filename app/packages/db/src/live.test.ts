import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, openDbReadOnly, type DbHandle } from "./client";
import { bumpTopic, bumpTopicIn, LIVE_TABLES, liveSeq, liveSince } from "./live";
import { createRepos, type Repos } from "./repos";
import { write } from "./tx";

// P50 L1: the triggers of migration 0019 record every write, in the writer's own transaction.
const here = dirname(fileURLToPath(import.meta.url));
let handle: DbHandle;
let repos: Repos;
beforeEach(() => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
});
afterEach(() => handle.close());

const moved = (since: number) => liveSince(handle.db, since).changes.map((c) => `${c.tbl}/${c.project}`);

describe("live triggers", () => {
  it("an insert, an update and a delete each bump the counter with the table and the project", async () => {
    const s0 = liveSeq(handle.db);
    const clientId = await repos.clients.create({ project: "p", email: "a@x.example", name: "A" });
    const s1 = liveSeq(handle.db);
    expect(s1).toBeGreaterThan(s0);
    expect(moved(s0)).toEqual(["clients/p"]);
    const draftId = await repos.drafts.create({ project: "p", clientId, subject: "s", toAddr: "a@x.example", body: "b", status: "ready" });
    const s2 = liveSeq(handle.db);
    expect(moved(s1)).toEqual(["drafts/p"]);
    await repos.drafts.setStatus(draftId, "hold");
    const s3 = liveSeq(handle.db);
    expect(s3).toBeGreaterThan(s2);
    expect(moved(s2)).toContain("drafts/p");
    handle.db.$client.prepare("DELETE FROM drafts WHERE id = ?").run(draftId);
    expect(moved(s3)).toEqual(["drafts/p"]);
  });

  it("a rolled-back write bumps nothing", () => {
    const s0 = liveSeq(handle.db);
    expect(() =>
      write(handle.db, () => {
        handle.db.$client.prepare("INSERT INTO clients (project, email, name, replies_owed, created_at, updated_at) VALUES ('p', 'a@x.example', 'A', 0, 'x', 'x')").run();
        throw new Error("abort");
      }),
    ).toThrow("abort");
    expect(liveSeq(handle.db)).toBe(s0);
    expect(moved(s0)).toEqual([]);
  });

  it("a 500-row update leaves one version row for the table and project", () => {
    const c = handle.db.$client;
    const ins = c.prepare("INSERT INTO clients (project, email, name, replies_owed, created_at, updated_at) VALUES ('p', ?, 'A', 0, 'x', 'x')");
    c.transaction(() => { for (let i = 0; i < 500; i++) ins.run(`a${i}@x.example`); })();
    const s0 = liveSeq(handle.db);
    c.prepare("UPDATE clients SET replies_owed = 1").run();
    expect(liveSeq(handle.db)).toBe(s0 + 500);
    expect(liveSince(handle.db, s0).changes).toEqual([{ tbl: "clients", project: "p", seq: s0 + 500 }]);
  });

  it("a project moved by an update is recorded under both names", () => {
    const c = handle.db.$client;
    c.prepare("INSERT INTO clients (project, email, name, replies_owed, created_at, updated_at) VALUES ('old', 'a@x.example', 'A', 0, 'x', 'x')").run();
    const s0 = liveSeq(handle.db);
    c.prepare("UPDATE clients SET project = 'new'").run();
    expect(moved(s0).sort()).toEqual(["clients/new", "clients/old"]);
  });

  it("bumpTopic takes the same path, with '' for the instance", () => {
    const s0 = liveSeq(handle.db);
    bumpTopic(handle.db, "connections", null);
    bumpTopic(handle.db, "health", "p");
    expect(moved(s0)).toEqual(["topic:connections/", "topic:health/p"]);
  });

  it("every table in schema.ts has its three triggers, and the live tables have none", () => {
    const triggers = (handle.db.$client.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'live\\_%' ESCAPE '\\'").all() as { name: string; tbl_name: string }[]);
    expect(LIVE_TABLES.length).toBeGreaterThanOrEqual(20);
    for (const t of LIVE_TABLES) expect(triggers.filter((r) => r.tbl_name === t).map((r) => r.name).sort(), t).toEqual([`live_${t}_ad`, `live_${t}_ai`, `live_${t}_au`]);
    expect(triggers.filter((r) => r.tbl_name.startsWith("live_"))).toEqual([]);
    expect(triggers).toHaveLength(LIVE_TABLES.length * 3);
  });
});

describe("live across processes", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "hub-live-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("a draft recorded by another process is seen by this process's liveSince", () => {
    const file = join(dir, "t.db");
    const mine = openDb(file);
    try {
      const s0 = liveSeq(mine.db);
      const script = join(dir, "record.mts");
      writeFileSync(script, `import { openDb, createRepos } from ${JSON.stringify(resolve(here, "index.ts"))};
const h = openDb(${JSON.stringify(file)});
await createRepos(h.db).drafts.record({ project: "p", email: "a@x.example", name: "Anna", subject: "S", mailRef: "<a@x>", reason: "asked", skill: "triage-mail" });
h.close();
`);
      execFileSync(resolve(here, "../node_modules/.bin/tsx"), [script], { stdio: "pipe", env: { ...process.env } });
      const seen = liveSince(mine.db, s0);
      expect(seen.seq).toBeGreaterThan(s0);
      expect(seen.changes.map((c) => c.tbl)).toEqual(expect.arrayContaining(["clients", "drafts", "agent_runs"]));
      expect(new Set(seen.changes.map((c) => c.project))).toEqual(new Set(["p"]));
    } finally {
      mine.close();
    }
  });

  it("bumpTopicIn writes only the live counter, beside a read-only handle of the same file (P53, hub mcp)", () => {
    const file = join(dir, "m.db");
    const mine = openDb(file);
    const reader = openDbReadOnly(file);
    try {
      const s0 = liveSeq(mine.db);
      expect(() => reader.db.$client.prepare("UPDATE live_seq SET n = n + 1").run()).toThrow(/readonly/i);
      const n = bumpTopicIn(file, "mail", "p");
      expect(n).toBe(s0 + 1);
      expect(liveSince(mine.db, s0).changes).toEqual([{ tbl: "topic:mail", project: "p", seq: s0 + 1 }]);
      expect(() => bumpTopicIn(join(dir, "missing.db"), "mail", "p")).toThrow();
    } finally {
      reader.close();
      mine.close();
    }
  });
});
