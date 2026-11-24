import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb } from "@hub/db";
import { draftWriteCall } from "../src/mcp/tools/draft-write";
import { recordDraftCall } from "../src/records/draft";
import { draftRecord } from "../src/records/schema";
import { okOf, recordCall, recordsInstance } from "./records-fixture";

// The draft record `draft_write` writes after Mail saved a reply (P129 A3, decision 0045 point 10; no shell command any more):
// one client and one draft row, nothing of the mail's text; what the record schema refuses; a busy database.

let db: string;
beforeEach(() => {
  db = path.join(mkdtempSync(path.join(tmpdir(), "hub-rec-")), "app.db");
});

const call = (record: Record<string, unknown> = {}, c: { subject?: string; mailRef?: string | null; ownerRequest?: string } = {}) =>
  recordCall({ email: "Client@Example.com", subject: c.subject ?? "Re: hello", mailRef: c.mailRef === undefined ? "<m1@example.com>" : c.mailRef, ...(c.ownerRequest ? { ownerRequest: c.ownerRequest } : {}) }, { name: "Cli Ent", ...record });
const run = (record?: Record<string, unknown>, c?: Parameters<typeof call>[1], attempts = 1) => recordDraftCall(call(record, c), { dbPath: db, attempts, retryMs: 5 });
const rowsOf = async () => {
  const h = openDb(db);
  try {
    return await createRepos(h.db).clients.list("acme");
  } finally {
    h.close();
  }
};

describe("the draft record (draft_write's writer)", () => {
  it("writes one client and one draft", async () => {
    const r = await run({ reason: "They asked.", last_contact_at: "2026-11-10", replies_owed: true, marks: ["follow_up"] });
    expect(r).toMatchObject({ ok: true, action: "created", recorded: true });
    const rows = await rowsOf();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "client@example.com", name: "Cli Ent", repliesOwed: true, lastContactAt: "2026-11-10T00:00:00.000Z", marks: ["follow_up"] });
    expect(rows[0]?.draft).toMatchObject({ status: "ready", subject: "Re: hello", reason: "They asked.", batchId: null });
  });

  it("the same mailRef twice leaves one row", async () => {
    await run();
    expect(await run({}, { subject: "Re: hello (edited)" })).toMatchObject({ ok: true, action: "updated" });
    const rows = await rowsOf();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.draft?.subject).toBe("Re: hello (edited)");
  });

  it("P99 S0 (b): the same mailRef on a finished draft says plainly that nothing was recorded", async () => {
    const first = okOf(await run());
    expect(first.recorded).toBe(true);
    const h = openDb(db);
    await createRepos(h.db).drafts.setStatus(first.draftId, "done");
    h.close();
    const again = okOf(await run({ excerpt: "A poem." }));
    expect(again).toMatchObject({ recorded: false, action: "unchanged", draftId: first.draftId });
    expect(again.message).toMatch(/^Not recorded:/);
    expect(again.message).toMatch(/is done .*nothing was recorded.*ownerRequest/);
  });

  it("a new thread is recorded only on the owner's words; a follow-up step only with the sequence skill", async () => {
    expect(await run({}, { mailRef: null })).toMatchObject({ ok: false, code: "record_invalid", error: expect.stringMatching(/owner_request/) });
    expect(await run({ skill: "triage-mail", sequence: { enrollment_id: 1, step: 1 } })).toMatchObject({ ok: false, code: "record_invalid", error: expect.stringMatching(/sequence-drafts/) });
    expect(await rowsOf()).toEqual([]);
    const fresh = okOf(await run({ skill: "bulk-drafts" }, { mailRef: null, ownerRequest: "write to the client" }));
    expect(fresh.action).toBe("created");
    const h = openDb(db);
    try {
      const d = (await createRepos(h.db).drafts.get(fresh.draftId))!;
      expect(d.mailRef).toBeNull();
      expect(JSON.parse(d.context ?? "{}")).toMatchObject({ ownerRequest: "write to the client", newThread: true });
    } finally {
      h.close();
    }
  });

  it("the record schema refuses a bad field, an unknown key and the old camelCase names; the call's own address and subject are checked by draft_write", async () => {
    for (const bad of [{ reason: "r".repeat(1501) }, { marks: ["boss"] }, { status: "sent" }, { last_contact_at: "yesterday" }, { lastContactAt: "2026-11-10" }, { mailClass: "client" }, { notion: { kind: "client" } }, { notion: { kind: "none", page_id: "0123456789abcdef0123456789abcdef" } }]) {
      expect(draftRecord.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    // A reply's address and subject come from Mail; a new thread's are the call's, refused before Mail is asked.
    for (const bad of [{ to: "nope", subject: "s" }, { to: "c@x.example", subject: "" }, { to: "c@x.example", subject: "s".repeat(301) }]) {
      expect(draftWriteCall.safeParse({ kind: "new", content: "Hi", owner_request: "write to them", record: {}, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(await rowsOf()).toEqual([]);
  });

  it("reports a busy database after the attempts, and works once the lock is released", async () => {
    openDb(db).close(); // migrate first, so the lock below is the only thing in the way
    // The lock must come from another process: connections inside one process share the lock state and never block each other.
    const blocker = spawn("node", ["-e", `const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(${JSON.stringify(db)});d.exec("pragma busy_timeout=0; begin immediate");console.log("locked");setTimeout(()=>{},60000)`], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise((r) => blocker.stdout.once("data", r));
    const t0 = Date.now();
    const busy = await run({}, {}, 2);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(5000); // the 5 s busy timeout of openDb, at least once
    expect(busy).toMatchObject({ ok: false, code: "busy" });
    blocker.kill();
    await new Promise((r) => blocker.once("exit", r));
    expect(await run()).toMatchObject({ ok: true });
  }, 30_000);
});

// The two facts `hub send` needs and the agent alone knows: the mail class and the injection hint.
describe("the draft record: send facts", () => {
  const send = (record: Record<string, unknown>) => {
    const i = recordsInstance();
    return { i, out: recordDraftCall(recordCall({ email: "c@example.com", subject: "Re: x", mailRef: "<m@x>" }, record), { dbPath: i.db, attempts: 1, projectsDir: i.projects, policyDir: i.policy }) };
  };

  it("stores mail_class and injection_suspected", async () => {
    const { i, out } = send({ mail_class: "client", injection_suspected: true });
    expect(await out).toMatchObject({ ok: true });
    const h = openDb(i.db);
    try {
      const [d] = await createRepos(h.db).clients.list("acme");
      expect(d?.draft).toMatchObject({ mailClass: "client", injectionSuspected: true });
    } finally {
      h.close();
    }
  });

  it("refuses a class the project's kind does not have", async () => {
    expect(await send({ mail_class: "billing" }).out).toMatchObject({ ok: false, code: "record_invalid", error: expect.stringMatching(/not a class of kind generic/) });
  });

  it("refuses a non-boolean flag", () => {
    expect(draftRecord.safeParse({ injection_suspected: "yes" }).success).toBe(false);
  });
});
