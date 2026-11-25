import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DbHandle } from "../src/client";
import { createRepos, dueClients, judgeDue, type DueFacts, type Repos } from "../src/index";

// P142 F1 (decision 0050): the silent-client selector clause by clause, the reset on a client message, the reopen on our own new
// message, the count on a sent nudge, and the backfill of `last_outbound_at`. The plan is the agent's notes: nothing here refuses.

const source = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const TODAY = "2026-11-25";
const base = (o: Partial<DueFacts> = {}): DueFacts => ({
  clientId: 1,
  name: "Ann",
  email: "ann@a.test",
  doNotContact: false,
  enrolled: false,
  mail: { wrote: false, openDraft: false, theirLastAt: "2026-11-20T10:00:00.000Z", ourLastAt: "2026-11-21T10:00:00.000Z" },
  chats: [],
  plan: null,
  ...o,
});
const chat = (o: Partial<DueFacts["chats"][number]> = {}): DueFacts["chats"][number] => ({ id: 1, channel: "whatsapp", chatId: "+491", replyMode: "draft", lastInAt: null, lastOutAt: null, openDraft: false, ...o });

describe("the selector (verdict 2)", () => {
  it("lists a client whose newest message is ours, with no plan yet", () => {
    const d = judgeDue(base(), TODAY);
    expect(typeof d).toBe("object");
    expect(d).toMatchObject({ clientId: 1, lastChannel: "mail", ourLastAt: "2026-11-21T10:00:00.000Z" });
  });
  it("each clause keeps a client out with its own code", () => {
    expect(judgeDue(base({ doNotContact: true }), TODAY)).toBe("do_not_contact");
    expect(judgeDue(base({ enrolled: true }), TODAY)).toBe("enrolled");
    expect(judgeDue(base({ mail: { wrote: false, openDraft: false, theirLastAt: "2026-11-22T10:00:00.000Z", ourLastAt: "2026-11-21T10:00:00.000Z" } }), TODAY)).toBe("they_wrote_last");
    expect(judgeDue(base({ mail: { wrote: true, openDraft: false, theirLastAt: null, ourLastAt: "2026-11-21T10:00:00.000Z" } }), TODAY)).toBe("they_wrote_last");
    expect(judgeDue(base({ mail: { wrote: false, openDraft: true, theirLastAt: null, ourLastAt: "2026-11-21T10:00:00.000Z" } }), TODAY)).toBe("draft_waits");
    expect(judgeDue(base({ chats: [chat({ lastOutAt: "2026-11-22T00:00:00.000Z", openDraft: true })] }), TODAY)).toBe("draft_waits");
    expect(judgeDue(base({ mail: null }), TODAY)).toBe("no_message");
    expect(judgeDue(base({ plan: { state: "stopped", nextAt: null, nudgesSent: 3 } }), TODAY)).toBe("plan_closed");
    expect(judgeDue(base({ plan: { state: "handed_over", nextAt: null, nudgesSent: 0 } }), TODAY)).toBe("plan_closed");
    expect(judgeDue(base({ plan: { state: "waiting", nextAt: "2026-11-26", nudgesSent: 1 } }), TODAY)).toBe("plan_later");
  });
  it("a plan due today or earlier, an answered plan and a plan with no date are listed", () => {
    for (const plan of [{ state: "waiting" as const, nextAt: TODAY, nudgesSent: 1 }, { state: "waiting" as const, nextAt: "2026-11-20", nudgesSent: 1 }, { state: "waiting" as const, nextAt: null, nudgesSent: 0 }, { state: "answered" as const, nextAt: null, nudgesSent: 0 }]) {
      expect(typeof judgeDue(base({ plan }), TODAY)).toBe("object");
    }
  });
  it("reads the linked chats with Mail: their newer chat message keeps the client out; ours makes the chat the channel", () => {
    expect(judgeDue(base({ chats: [chat({ lastInAt: "2026-11-23T00:00:00.000Z" })] }), TODAY)).toBe("they_wrote_last");
    expect(judgeDue(base({ mail: null, chats: [chat({ lastInAt: "2026-11-20T00:00:00.000Z", lastOutAt: "2026-11-23T00:00:00.000Z" })] }), TODAY)).toMatchObject({ lastChannel: "whatsapp" });
  });
  it("a chat with reply mode off is left out; on_request is listed for a hand-over", () => {
    expect(judgeDue(base({ mail: null, chats: [chat({ replyMode: "off", lastOutAt: "2026-11-23T00:00:00.000Z" })] }), TODAY)).toBe("no_message");
    expect(judgeDue(base({ mail: null, chats: [chat({ replyMode: "on_request", lastOutAt: "2026-11-23T00:00:00.000Z" })] }), TODAY)).toMatchObject({ onRequest: true });
  });
  it("orders the oldest next date first, then the longest silence", () => {
    const list = dueClients(
      [
        base({ clientId: 1, mail: { wrote: false, openDraft: false, theirLastAt: null, ourLastAt: "2026-11-10T00:00:00.000Z" } }),
        base({ clientId: 2, plan: { state: "waiting", nextAt: "2026-11-24", nudgesSent: 1 } }),
        base({ clientId: 3, plan: { state: "waiting", nextAt: "2026-11-20", nudgesSent: 1 } }),
        base({ clientId: 4, mail: { wrote: false, openDraft: false, theirLastAt: null, ourLastAt: "2026-11-01T00:00:00.000Z" } }),
      ],
      TODAY,
    );
    expect(list.map((c) => c.clientId)).toEqual([3, 2, 4, 1]);
  });
});

let handle: DbHandle;
let repos: Repos;
let ann: number;
const AT = "2026-11-24T09:00:00.000Z";
const plan = async (decision: "nudge" | "wait" | "stop" | "hand_over", at = AT) =>
  repos.followUps.decide({ project: "a", clientId: ann, decision, nextAt: decision === "nudge" || decision === "wait" ? "2026-11-27" : null, waitingOn: "them", reason: "a reason", stopReason: decision === "stop" ? "no_answer" : null, channel: "whatsapp", nudgeN: decision === "nudge" ? 1 : null, tz: "Europe/Berlin", line: "2026-11-24 · WhatsApp · жду", at, batchKey: "s1" });

beforeEach(async () => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  ann = await repos.clients.create({ project: "a", email: "ann@a.test", name: "Ann" });
  await repos.messengers.knowChat("a", "whatsapp", "+491", { title: "Ann" });
  await repos.messengers.addIdentifier("a", ann, "whatsapp", "+491");
});
afterEach(() => handle.close());

describe("the plan (verdicts 9 to 11)", () => {
  it("a decision is one row, a rerun the same day replaces it, and each call is one Activity line", async () => {
    const first = await plan("nudge");
    const again = await plan("wait", "2026-11-24T15:00:00.000Z");
    expect(again.sameDay).toBe(true);
    expect(again.row.id).toBe(first.row.id);
    expect(again.row.state).toBe("waiting");
    expect(again.row.nudgesSent).toBe(0);
    const lines = await repos.followUps.lines("a", ann);
    expect(lines.map((l) => l.summary)).toEqual(["Follow-up · Ann · nudged on WhatsApp (1st) · next 27 Nov", "Follow-up · Ann · waits · next 27 Nov"]);
  });
  it("the client writing after the decision resets the plan to answered; an older message from a refill does not", async () => {
    await plan("stop");
    await repos.messengers.noteChatFact("a", "whatsapp", "+491", { inboundAt: "2026-11-20T00:00:00.000Z" });
    expect((await repos.followUps.get("a", ann))?.state).toBe("stopped");
    await repos.messengers.noteChatFact("a", "whatsapp", "+491", { inboundAt: "2026-11-25T00:00:00.000Z" });
    expect(await repos.followUps.get("a", ann)).toMatchObject({ state: "answered", nudgesSent: 0, nextAt: null, stopReason: null });
  });
  it("an inbound Mail the reader keeps resets the plan", async () => {
    await plan("wait");
    await repos.inboundMail.store([{ project: "a", account: "x", mailbox: "INBOX", messageId: "<m1@a.test>", email: "ann@a.test", name: "Ann", subject: "Re", receivedAt: "2026-11-25T00:00:00.000Z", read: false, why: "client", preview: "yes" }]);
    expect((await repos.followUps.get("a", ann))?.state).toBe("answered");
  });
  it("our own new message after a stop or a hand-over reopens the plan, the count kept", async () => {
    await plan("hand_over");
    await repos.messengers.noteChatFact("a", "whatsapp", "+491", { outboundAt: "2026-11-25T00:00:00.000Z" });
    expect(await repos.followUps.get("a", ann)).toMatchObject({ state: "waiting", nextAt: null });
    expect((await repos.messengers.chat("a", "whatsapp", "+491"))?.lastOutboundAt).toBe("2026-11-25T00:00:00.000Z");
  });
  it("a sent nudge draft counts once; a skipped one never", async () => {
    await plan("nudge");
    const id = (handle.db.$client.prepare("insert into messenger_drafts (project, channel, chat_id, client_id, text, status, created_by, follow_up_n) values ('a', 'whatsapp', '+491', ?, 'hi', 'sent', 'follow_up', 1) returning id").get(ann) as { id: number }).id;
    handle.db.$client.prepare("insert into messenger_drafts (project, channel, chat_id, client_id, text, status, created_by, follow_up_n) values ('a', 'whatsapp', '+491', ?, 'no', 'discarded', 'follow_up', 2)").run(ann);
    await repos.followUps.messengerSent("a", id, "2026-11-25T08:00:00.000Z");
    expect(await repos.followUps.get("a", ann)).toMatchObject({ nudgesSent: 1, lastNudgeAt: "2026-11-25T08:00:00.000Z" });
    expect((await repos.messengers.chat("a", "whatsapp", "+491"))?.lastOutboundAt).toBe("2026-11-25T08:00:00.000Z");
  });
  it("the owner's Stop, Resume and Change date write the same row", async () => {
    await plan("nudge");
    expect((await repos.followUps.ownerStop("a", ann, "2026-11-25T00:00:00.000Z")).state).toBe("stopped");
    expect(await repos.followUps.ownerResume("a", ann, "2026-11-25T00:01:00.000Z")).toMatchObject({ state: "waiting", nextAt: null, decidedBy: "owner" });
    expect((await repos.followUps.ownerDate("a", ann, "2026-12-02", "2026-11-25T00:02:00.000Z")).nextAt).toBe("2026-12-02");
  });
  it("the selector over the database lists Ann once our chat message is the newest", async () => {
    await repos.messengers.noteChatFact("a", "whatsapp", "+491", { inboundAt: "2026-11-20T00:00:00.000Z", outboundAt: "2026-11-21T00:00:00.000Z" });
    const due = await repos.followUps.due("a", new Date("2026-11-25T09:00:00.000Z"));
    expect(due.clients.map((c) => [c.clientId, c.lastChannel])).toEqual([[ann, "whatsapp"]]);
  });
});

describe("the backfill of migration 0046 (verdict 14)", () => {
  it("fills last_outbound_at from sent messenger rows and the cache's outbound rows; invents no plan", () => {
    const db = drizzle(new Database(":memory:"));
    try {
      migrate(db, { migrationsFolder: folderUpTo(46) }); // 0000 .. 0045
      const c = db.$client;
      c.prepare("insert into messenger_chats (project, channel, chat_id) values ('a', 'whatsapp', '+491'), ('a', 'telegram_user', '42'), ('a', 'telegram_user', '43')").run();
      c.prepare("insert into send_log (project, mode, status, actor, done_at, to_addr, subject, body, channel) values ('a', 'manual', 'sent', 'admin', '2026-11-20T00:00:00.000Z', 'whatsapp:+491', 'Ann', 'hi', 'whatsapp'), ('a', 'manual', 'failed', 'admin', '2026-11-23T00:00:00.000Z', 'whatsapp:+491', 'Ann', 'hi', 'whatsapp')").run();
      c.prepare("insert into messenger_messages (project, channel, account, chat_id, remote_message_id, direction, sent_at, retain_until) values ('a', 'telegram_user', '1', '42', 'r1', 'out', '2026-11-21T00:00:00.000Z', '2027-01-01'), ('a', 'whatsapp', '1', '+491', 'r2', 'out', '2026-11-19T00:00:00.000Z', '2027-01-01')").run();
      migrate(db, { migrationsFolder: source }); // + 0046
      const out = c.prepare("select chat_id as id, last_outbound_at as at from messenger_chats order by chat_id").all();
      expect(out).toEqual([{ id: "+491", at: "2026-11-20T00:00:00.000Z" }, { id: "42", at: "2026-11-21T00:00:00.000Z" }, { id: "43", at: null }]);
      expect((c.prepare("select count(*) as n from follow_ups").get() as { n: number }).n).toBe(0);
    } finally {
      db.$client.close();
    }
  });
});

/** A migrations folder holding only the first `n` entries of the journal (as `migration.test.ts`). */
function folderUpTo(n: number): string {
  const dir = mkdtempSync(join(tmpdir(), "hub-mig-"));
  mkdirSync(join(dir, "meta"));
  const journal = JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
  const entries = journal.entries.slice(0, n);
  for (const e of entries) cpSync(join(source, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
  return dir;
}
