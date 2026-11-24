import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { restoreCheck } from "../src/backup-check";

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
    expect(cols("drafts")).toEqual(expect.arrayContaining(["findings", "context", "checked_hash"])); // P140 K2 (0043): the evidence columns are gone
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

    migrate(db, { migrationsFolder: folderUpTo(26) }); // + 0025 (0040 drops may_nudge and nudge_after_days again)

    expect(sqlite.prepare("select reply_mode, may_nudge, nudge_after_days, instruction, language, prefilter, rules_updated_at from messenger_chats").get()).toEqual({ reply_mode: "draft", may_nudge: 0, nudge_after_days: 3, instruction: null, language: null, prefilter: 0, rules_updated_at: null });
    expect(sqlite.prepare("select text, owner_request, nudge from messenger_drafts").get()).toEqual({ text: "hi", owner_request: null, nudge: 0 });
    const triggers = (sqlite.prepare("select name from sqlite_master where type = 'trigger' and name like 'live_messenger_%'").all() as { name: string }[]).map((t) => t.name);
    for (const t of ["messenger_chats", "messenger_drafts"]) for (const op of ["ai", "au", "ad"]) expect(triggers).toContain(`live_${t}_${op}`);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(sqlite.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    sqlite.close();
  });
});

describe("migration 0040 (no follow-up rule, owner 2026-11-24)", () => {
  it("drops may_nudge and nudge_after_days, keeps every chat with its other rules, the key and the three live triggers", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: folderUpTo(40) }); // 0000 .. 0039
    sqlite.prepare("insert into messenger_chats (project, channel, chat_id, title, reply_mode, may_nudge, nudge_after_days, instruction, language, prefilter) values ('p','telegram_user','42','Ann','on_request',1,7,'Formal.','ru',1)").run();
    sqlite.prepare("insert into messenger_drafts (project, channel, chat_id, text, created_by, nudge) values ('p','telegram_user','42','hi','agent',1)").run();

    migrate(db, { migrationsFolder: source }); // + 0040

    const cols = (sqlite.prepare("pragma table_info(messenger_chats)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).not.toContain("may_nudge");
    expect(cols).not.toContain("nudge_after_days");
    expect(sqlite.prepare("select chat_id, title, reply_mode, instruction, language, prefilter from messenger_chats").get()).toEqual({ chat_id: "42", title: "Ann", reply_mode: "on_request", instruction: "Formal.", language: "ru", prefilter: 1 });
    expect(sqlite.prepare("select text, nudge from messenger_drafts").get()).toEqual({ text: "hi", nudge: 1 });
    expect(() => sqlite.prepare("insert into messenger_chats (project, channel, chat_id) values ('p','telegram_user','42')").run()).toThrow(/UNIQUE/);
    expect(() => sqlite.prepare("update messenger_chats set reply_mode = 'auto'").run()).toThrow(/CHECK/);
    const triggers = (sqlite.prepare("select name from sqlite_master where type = 'trigger' and name like 'live_messenger_chats_%'").all() as { name: string }[]).map((t) => t.name).sort();
    expect(triggers).toEqual(["live_messenger_chats_ad", "live_messenger_chats_ai", "live_messenger_chats_au"]);
    const seq = () => (sqlite.prepare("select n from live_seq").get() as { n: number }).n;
    const before = seq();
    sqlite.prepare("update messenger_chats set reply_mode = 'draft'").run();
    expect(seq()).toBe(before + 1);
    expect(sqlite.prepare("select tbl, project, seq from live_versions where tbl = 'messenger_chats'").get()).toEqual({ tbl: "messenger_chats", project: "p", seq: before + 1 });
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(sqlite.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    sqlite.close();
  });
});

describe("migration 0041 (the chat's autopilot pause, P139 A1)", () => {
  it("adds the two pause columns as null, keeps every chat with its rules, the key and the three live triggers", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: folderUpTo(41) }); // 0000 .. 0040
    sqlite.prepare("insert into messenger_chats (project, channel, chat_id, title, reply_mode, instruction) values ('p','telegram_user','42','Ann','draft','Formal.')").run();

    migrate(db, { migrationsFolder: source }); // + 0041

    expect(sqlite.prepare("select chat_id, reply_mode, instruction, autopilot_paused_at, autopilot_paused_reason from messenger_chats").get()).toEqual({ chat_id: "42", reply_mode: "draft", instruction: "Formal.", autopilot_paused_at: null, autopilot_paused_reason: null });
    expect(() => sqlite.prepare("insert into messenger_chats (project, channel, chat_id) values ('p','telegram_user','42')").run()).toThrow(/UNIQUE/);
    const triggers = (sqlite.prepare("select name from sqlite_master where type = 'trigger' and name like 'live_messenger_chats_%'").all() as { name: string }[]).map((t) => t.name).sort();
    expect(triggers).toEqual(["live_messenger_chats_ad", "live_messenger_chats_ai", "live_messenger_chats_au"]);
    const seq = () => (sqlite.prepare("select n from live_seq").get() as { n: number }).n;
    const before = seq();
    sqlite.prepare("update messenger_chats set autopilot_paused_at = 'x', autopilot_paused_reason = 'owner_replied'").run();
    expect(seq()).toBe(before + 1);
    expect(sqlite.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    sqlite.close();
  });
});

describe("migration 0042 (the proof of inbound outlives the cache, P141 W4)", () => {
  it("adds jid, last_inbound_at, account and source; backfills the fact from stored messages; keeps the key and the live triggers", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: folderUpTo(42) }); // 0000 .. 0041
    sqlite.prepare("insert into messenger_chats (project, channel, chat_id, title) values ('p','telegram_user','42','Ann'), ('p','whatsapp','+4915100','B'), ('p','whatsapp','+4915111','C')").run();
    const msg = sqlite.prepare("insert into messenger_messages (project, channel, account, chat_id, remote_message_id, direction, kind, text, sent_at, retain_until) values ('p', ?, ?, ?, ?, ?, 'text', '', ?, '2027-01-01T00:00:00.000Z')");
    msg.run("telegram_user", "777", "42", "1", "in", "2026-11-20T10:00:00.000Z");
    msg.run("telegram_user", "777", "42", "2", "in", "2026-11-21T10:00:00.000Z");
    msg.run("telegram_user", "888", "42", "3", "out", "2026-11-22T10:00:00.000Z");
    // Only the owner wrote in this chat: no inbound fact, the account from his message.
    msg.run("whatsapp", "6281", "+4915100", "W1", "out", "2026-11-22T10:00:00.000Z");

    migrate(db, { migrationsFolder: source }); // + 0042

    const rows = sqlite.prepare("select chat_id, jid, last_inbound_at, account from messenger_chats order by id").all();
    expect(rows).toEqual([
      { chat_id: "42", jid: null, last_inbound_at: "2026-11-21T10:00:00.000Z", account: "777" },
      { chat_id: "+4915100", jid: null, last_inbound_at: null, account: "6281" },
      { chat_id: "+4915111", jid: null, last_inbound_at: null, account: null },
    ]);
    expect(sqlite.prepare("select count(*) as n from messenger_messages where source is null").get()).toEqual({ n: 4 });
    expect(() => sqlite.prepare("insert into messenger_chats (project, channel, chat_id) values ('p','telegram_user','42')").run()).toThrow(/UNIQUE/);
    const triggers = (sqlite.prepare("select name from sqlite_master where type = 'trigger' and (name like 'live_messenger_chats_%' or name like 'live_messenger_messages_%')").all() as { name: string }[]).map((t) => t.name).sort();
    expect(triggers).toEqual(["live_messenger_chats_ad", "live_messenger_chats_ai", "live_messenger_chats_au", "live_messenger_messages_ad", "live_messenger_messages_ai", "live_messenger_messages_au"]);
    expect(sqlite.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    sqlite.close();
  });
});

describe("migration 0043 (the version keeps its brand; the evidence check is gone, P140 R3 and K2)", () => {
  it("adds brand and wrote_to, drops the evidence columns, keeps fact-other-brand findings, drops the removed kinds' rules and acks; keeps the live triggers", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: folderUpTo(43) }); // 0000 .. 0042
    sqlite.prepare("insert into clients (project, email, name, replies_owed, created_at) values ('p','a@x.example','A',0,'2026-11-01T00:00:00.000Z')").run();
    const findings = JSON.stringify([{ code: "no-thread-read", text: "x", amber: false }, { code: "fact-other-brand", text: "y", amber: false }]);
    sqlite.prepare("insert into drafts (project, client_id, subject, to_addr, body, evidence, evidence_source, evidence_findings, similar_to, fingerprint, acked) values ('p',1,'s','a@x.example','b','weak','claimed',?,'b@x','[1,2]','[\"cc_present\",\"evidence_weak\"]')").run(findings);
    sqlite.prepare("insert into drafts (project, client_id, subject, to_addr, body, status) values ('p',1,'s2','a@x.example','b','done')").run();
    sqlite.prepare("insert into safety_rules (project, kind, enabled, level, params) values ('p','evidence_weak',1,'amber','{}'), ('p','cc_present',0,'amber','{}')").run();
    sqlite.prepare("insert into mail_versions (project, mail_ref, draft_id, account, mail_id, message_id, hash, source, written_at) values ('p','r@x',1,'a',1,'m@x','h','agent','2026-11-24T00:00:00.000Z')").run();

    migrate(db, { migrationsFolder: source }); // + 0043

    const cols = (t: string) => (sqlite.prepare(`select name from pragma_table_info('${t}')`).all() as { name: string }[]).map((c) => c.name);
    for (const gone of ["evidence", "evidence_source", "evidence_findings", "similar_to", "fingerprint"]) expect(cols("drafts")).not.toContain(gone);
    expect(cols("drafts")).toContain("findings");
    expect(cols("mail_versions")).toEqual(expect.arrayContaining(["brand", "wrote_to"]));
    const d = sqlite.prepare("select findings, acked from drafts where id = 1").get() as { findings: string; acked: string };
    expect(JSON.parse(d.findings)).toEqual([{ code: "fact-other-brand", text: "y", amber: false }]);
    expect(JSON.parse(d.acked)).toEqual(["cc_present"]);
    expect(sqlite.prepare("select findings, acked from drafts where id = 2").get()).toEqual({ findings: null, acked: "[]" });
    expect(sqlite.prepare("select kind from safety_rules").all()).toEqual([{ kind: "cc_present" }]);
    expect(sqlite.prepare("select brand, wrote_to from mail_versions").get()).toEqual({ brand: null, wrote_to: null });
    const triggers = (sqlite.prepare("select name from sqlite_master where type = 'trigger' and (name like 'live_drafts_%' or name like 'live_mail_versions_%' or name like 'live_safety_rules_%')").all() as { name: string }[]).map((t) => t.name).sort();
    expect(triggers).toEqual(["live_drafts_ad", "live_drafts_ai", "live_drafts_au", "live_mail_versions_ad", "live_mail_versions_ai", "live_mail_versions_au", "live_safety_rules_ad", "live_safety_rules_ai", "live_safety_rules_au"]);
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

describe("only a migrating opener applies migrations to an existing database (P141)", () => {
  it("refuses a database that is behind unless the opener migrates, and migrates a new one", async () => {
    const { DbBehindError, openDb } = await import("../src/client");
    const tmp = mkdtempSync(join(tmpdir(), "hub-guard-"));
    const old = join(tmp, "old.db");
    const sqlite = new Database(old);
    migrate(drizzle(sqlite), { migrationsFolder: folderUpTo(14) });
    sqlite.close();
    expect(() => openDb(old)).toThrow(DbBehindError);
    openDb(old, { migrate: true }).close();
    openDb(old).close(); // nothing pending now: any opener may open it
    openDb(join(tmp, "fresh.db")).close(); // a new database migrates by itself
  });
});

describe("migration 0044 (a client needs no email, P141 C1)", () => {
  it("makes email nullable without a rebuild, keeps every client with its marks, drafts, maps and identifiers, the live triggers and a partial unique email", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: folderUpTo(44) }); // 0000 .. 0043
    sqlite.prepare("insert into clients (project, email, name) values ('p','a@x.example','A'), ('p','b@x.example','+966544555430')").run();
    sqlite.prepare("insert into marks (project, client_id, mark) values ('p',1,'vip')").run();
    sqlite.prepare("insert into drafts (project, client_id, subject, to_addr, body) values ('p',1,'s','a@x.example','b')").run();
    sqlite.prepare("insert into client_maps (project, client_id, source, created_at) values ('p',1,'graph TD','2026-11-24T00:00:00.000Z')").run();
    sqlite.prepare("insert into client_identifiers (project, client_id, kind, value) values ('p',2,'whatsapp','+966544555430')").run();

    migrate(db, { migrationsFolder: source }); // + 0044, inside the migrator's one transaction with foreign keys on

    expect(sqlite.prepare("select id, email, name from clients order by id").all()).toEqual([
      { id: 1, email: "a@x.example", name: "A" },
      { id: 2, email: "b@x.example", name: "+966544555430" },
    ]);
    for (const t of ["marks", "drafts", "client_maps", "client_identifiers"]) expect(sqlite.prepare(`select count(*) as n from ${t}`).get()).toEqual({ n: 1 });
    // Two chat-only clients coexist; a set email stays unique; a Notion card belongs to one client.
    sqlite.prepare("insert into clients (project, email, name) values ('p', null, 'WhatsApp +1'), ('p', null, 'Telegram @t')").run();
    expect(() => sqlite.prepare("insert into clients (project, email, name) values ('p','a@x.example','dup')").run()).toThrow(/UNIQUE/);
    sqlite.prepare("update clients set notion_page_id = 'pg-1' where id = 1").run();
    expect(() => sqlite.prepare("update clients set notion_page_id = 'pg-1' where id = 2").run()).toThrow(/UNIQUE/);
    expect(() => sqlite.prepare("insert into client_identifiers (project, client_id, kind, value) values ('p',1,'whatsapp','+966544555430')").run()).toThrow(/UNIQUE/);
    const cols = (t: string) => (sqlite.prepare(`pragma table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols("clients")).toEqual(expect.arrayContaining(["email", "notion_page_id", "merged_into"]));
    expect(cols("clients")).not.toContain("email_new");
    expect(cols("messenger_chats")).toContain("profile_name");
    const triggers = (sqlite.prepare("select name from sqlite_master where type = 'trigger' and name like 'live_clients_%'").all() as { name: string }[]).map((t) => t.name).sort();
    expect(triggers).toEqual(["live_clients_ad", "live_clients_ai", "live_clients_au"]);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(sqlite.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    sqlite.close();
  });
});
