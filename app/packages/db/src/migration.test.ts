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

describe("migration 0015 (not by email)", () => {
  it("adds kind and phone to inbox_rows and keeps every existing row, as an ordinary one", () => {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: folderUpTo(15) }); // 0000 .. 0014
    sqlite.prepare("insert into inbox_rows (project, email, name, action, replies_owed, first_seen_at, recorded_at) values ('p','a@x.example','A','escalated',1,'2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z')").run();
    migrate(db, { migrationsFolder: source });
    const cols = (sqlite.prepare("pragma table_info(inbox_rows)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["kind", "phone"]));
    expect(sqlite.prepare("select email, action, replies_owed, kind, phone from inbox_rows").get()).toEqual({ email: "a@x.example", action: "escalated", replies_owed: 1, kind: null, phone: null });
    sqlite.close();
  });
});

describe("migration 0016 (enrollments)", () => {
  it("adds the enrollments table with one open row per client, and the two step columns of drafts, keeping every draft", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: folderUpTo(16) }); // 0000 .. 0015
    sqlite.prepare("insert into clients (project, email, name, replies_owed, created_at) values ('p','a@x.example','A',0,'2026-11-01T00:00:00.000Z')").run();
    sqlite.prepare("insert into drafts (project, client_id, subject, to_addr, body, status) values ('p',1,'s','a@x.example','b','sent')").run();
    migrate(db, { migrationsFolder: source });
    const cols = (t: string) => (sqlite.prepare(`pragma table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols("drafts")).toEqual(expect.arrayContaining(["enrollment_id", "sequence_step"]));
    expect(cols("enrollments")).toEqual(["id", "project", "client_id", "sequence", "sequence_hash", "schedule", "step", "state", "next_due_at", "anchor_at", "enrolled_at", "enrolled_by", "finished_at", "finish_reason", "updated_at", "enrolled_phrase"]);
    expect(sqlite.prepare("select status, enrollment_id, sequence_step from drafts").get()).toEqual({ status: "sent", enrollment_id: null, sequence_step: null });
    const add = (state: string) => sqlite.prepare("insert into enrollments (project, client_id, sequence, sequence_hash, schedule, state, anchor_at, enrolled_at, enrolled_by, updated_at) values ('p',1,'s','h','{}',?, 'x','x','owner','x')").run(state);
    add("finished");
    add("active");
    expect(() => add("paused")).toThrow(/UNIQUE/);
    add("finished");
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
  });
});

describe("migrations 0017 and 0018 (enrolled phrase, a run's batch key)", () => {
  it("adds the two nullable columns and keeps every row", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: folderUpTo(17) }); // 0000 .. 0016
    sqlite.prepare("insert into clients (project, email, name, replies_owed, created_at) values ('p','a@x.example','A',0,'2026-11-01T00:00:00.000Z')").run();
    sqlite.prepare("insert into enrollments (project, client_id, sequence, sequence_hash, schedule, state, anchor_at, enrolled_at, enrolled_by, updated_at) values ('p',1,'s','h','{}','active','x','x','owner','x')").run();
    sqlite.prepare("insert into agent_runs (project, started_at, trigger) values ('p','x','owner')").run();
    migrate(db, { migrationsFolder: source });
    expect(sqlite.prepare("select enrolled_by, enrolled_phrase from enrollments").get()).toEqual({ enrolled_by: "owner", enrolled_phrase: null });
    expect(sqlite.prepare("select trigger, batch_key from agent_runs").get()).toEqual({ trigger: "owner", batch_key: null });
    expect((sqlite.prepare("pragma index_list(agent_runs)").all() as { name: string }[]).map((i) => i.name)).toContain("agent_runs_project_batch_key");
    sqlite.close();
  });
});

describe("migration 0025 (messenger chat rules, P71 M2b)", () => {
  it("adds the rules with their defaults to linked chats, keeps every row and the three live triggers of each messenger table", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: folderUpTo(25) }); // 0000 .. 0024
    sqlite.prepare("insert into messenger_chats (project, channel, chat_id, title) values ('p','telegram_user','42','Ann')").run();
    sqlite.prepare("insert into messenger_drafts (project, channel, chat_id, text, created_by) values ('p','telegram_user','42','hi','agent')").run();

    migrate(db, { migrationsFolder: source }); // + 0025

    expect(sqlite.prepare("select reply_mode, may_nudge, nudge_after_days, instruction, language, prefilter, rules_updated_at from messenger_chats").get()).toEqual({ reply_mode: "draft", may_nudge: 0, nudge_after_days: 3, instruction: null, language: null, prefilter: 0, rules_updated_at: null });
    expect(sqlite.prepare("select text, owner_request, nudge from messenger_drafts").get()).toEqual({ text: "hi", owner_request: null, nudge: 0 });
    const triggers = (sqlite.prepare("select name from sqlite_master where type = 'trigger' and name like 'live_messenger_%'").all() as { name: string }[]).map((t) => t.name);
    for (const t of ["messenger_chats", "messenger_drafts"]) for (const op of ["ai", "au", "ad"]) expect(triggers).toContain(`live_${t}_${op}`);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(sqlite.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    sqlite.close();
  });
});

describe("migration 0026 (llm_calls, P78)", () => {
  it("adds the ledger with its three live triggers, keeps older rows, and refuses an unknown outcome or a negative cost", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: folderUpTo(26) }); // 0000 .. 0025
    sqlite.prepare("insert into agent_runs (project, started_at, trigger) values ('p','x','owner')").run();

    migrate(db, { migrationsFolder: source }); // + 0026

    expect(sqlite.prepare("select count(*) as n from agent_runs").get()).toEqual({ n: 1 });
    sqlite.prepare("insert into llm_calls (project, task, model, attempt, outcome, cost_micro_usd) values ('p','t','m',1,'ok',812)").run();
    expect(sqlite.prepare("select outcome, cost_micro_usd, tokens_in, generation_id from llm_calls").get()).toEqual({ outcome: "ok", cost_micro_usd: 812, tokens_in: 0, generation_id: null });
    expect(() => sqlite.prepare("insert into llm_calls (project, task, attempt, outcome) values ('p','t',1,'maybe')").run()).toThrow(/CHECK/);
    expect(() => sqlite.prepare("insert into llm_calls (project, task, attempt, outcome, cost_micro_usd) values ('p','t',1,'ok',-1)").run()).toThrow(/CHECK/);
    const triggers = (sqlite.prepare("select name from sqlite_master where type = 'trigger' and name like 'live_llm_calls_%'").all() as { name: string }[]).map((t) => t.name).sort();
    expect(triggers).toEqual(["live_llm_calls_ad", "live_llm_calls_ai", "live_llm_calls_au"]);
    expect(sqlite.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    sqlite.close();
  });
});

describe("migration 0027 (send_log channel, P71 M4)", () => {
  it("marks every older send as mail, keeps the rows and the live triggers, and names a messenger draft with one live row", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: folderUpTo(27) }); // 0000 .. 0026
    sqlite.prepare("insert into clients (project, email, name, replies_owed, created_at) values ('p','a@x.example','A',0,'2026-11-01T00:00:00.000Z')").run();
    sqlite.prepare("insert into drafts (project, client_id, subject, to_addr, body) values ('p',1,'s','a@x.example','b')").run();
    sqlite.prepare("insert into send_log (project, draft_id, mode, status, actor, to_addr, subject, body) values ('p',1,'manual','sent','admin','a@x.example','s','b')").run();
    sqlite.prepare("insert into messenger_drafts (project, channel, chat_id, text, created_by) values ('p','telegram_user','42','hi','agent')").run();

    migrate(db, { migrationsFolder: source }); // + 0027

    expect(sqlite.prepare("select channel, messenger_draft_id, draft_id from send_log").get()).toEqual({ channel: "mail", messenger_draft_id: null, draft_id: 1 });
    const add = (status: string) => sqlite.prepare(`insert into send_log (project, channel, messenger_draft_id, mode, status, actor, sender, to_addr, subject, body) values ('p','telegram_user',1,'manual','${status}','admin','7','telegram:42','A','hi')`).run();
    add("failed");
    add("sending");
    expect(() => add("sent")).toThrow(/UNIQUE/);
    expect(() => sqlite.prepare("insert into send_log (project, channel, mode, status, actor, to_addr, subject, body) values ('p','fax','manual','sent','a','x','s','b')").run()).toThrow(/CHECK/);
    const triggers = (sqlite.prepare("select name from sqlite_master where type = 'trigger' and name like 'live_send_log_%'").all() as { name: string }[]).map((t) => t.name).sort();
    expect(triggers).toEqual(["live_send_log_ad", "live_send_log_ai", "live_send_log_au"]);
    sqlite.prepare("delete from messenger_drafts").run();
    expect(sqlite.prepare("select count(*) as n from send_log where channel = 'telegram_user' and messenger_draft_id is null").get()).toEqual({ n: 2 });
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(sqlite.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    sqlite.close();
  });
});

describe("migration 0029 (messenger_triage, P71 M-P)", () => {
  it("adds the verdicts with their live triggers, refuses an unknown verdict, and a verdict goes with its message", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: folderUpTo(29) }); // 0000 .. 0028
    sqlite.prepare("insert into messenger_messages (project, channel, account, chat_id, remote_message_id, direction, text, sent_at, retain_until) values ('p','telegram_user','1','c','r1','in','thanks','2026-11-20T00:00:00.000Z','2026-01-01T00:00:00.000Z')").run();

    migrate(db, { migrationsFolder: source }); // + 0029

    expect(sqlite.prepare("select count(*) as n from messenger_messages").get()).toEqual({ n: 1 });
    sqlite.prepare("insert into messenger_triage (project, message_id, verdict, model, prompt_version) values ('p', 1, 'closing', 'm', 1)").run();
    expect(() => sqlite.prepare("insert into messenger_triage (project, message_id, verdict, prompt_version) values ('p', 1, 'needs_reply', 1)").run()).toThrow(/UNIQUE/);
    expect(() => sqlite.prepare("insert into messenger_triage (project, message_id, verdict, prompt_version) values ('p', 1, 'maybe', 1)").run()).toThrow(/CHECK/);
    expect(() => sqlite.prepare("insert into messenger_triage (project, message_id, verdict, prompt_version) values ('p', 99, 'fyi', 1)").run()).toThrow(/FOREIGN KEY/);
    const triggers = (sqlite.prepare("select name from sqlite_master where type = 'trigger' and name like 'live_messenger_triage_%'").all() as { name: string }[]).map((t) => t.name).sort();
    expect(triggers).toEqual(["live_messenger_triage_ad", "live_messenger_triage_ai", "live_messenger_triage_au"]);
    // The retention purge's delete takes the verdict along (ON DELETE CASCADE).
    sqlite.prepare("delete from messenger_messages where retain_until < '2026-11-20'").run();
    expect(sqlite.prepare("select count(*) as n from messenger_triage").get()).toEqual({ n: 0 });
    expect(sqlite.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
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
