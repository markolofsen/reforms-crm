import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SAFETY_RULES } from "@hub/config";
import { openDb, type DbHandle } from "./client";
import { RepoError } from "./errors";
import { createRepos, type Repos } from "./repos";
import { evaluateSafety } from "./safety";
import { batches } from "./schema";

let handle: DbHandle;
let repos: Repos;
const NOW = new Date("2026-11-14T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

beforeEach(() => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
});
afterEach(() => handle.close());

async function client(project: string, email: string, o: { name?: string; owed?: boolean; silent?: number; marks?: ("follow_up" | "do_not_contact" | "vip")[]; draft?: "ready" | "hold" | "done" } = {}) {
  const id = await repos.clients.create({
    project,
    email,
    name: o.name ?? email.split("@")[0]!,
    repliesOwed: o.owed ?? false,
    lastContactAt: daysAgo(o.silent ?? 3),
  });
  if (o.marks) await repos.clients.setMarks(id, o.marks);
  if (o.draft) await repos.drafts.create({ project, clientId: id, subject: "old", toAddr: email, body: "old", status: o.draft });
  return id;
}

const BRIEF = "Check in with silent clients: short and warm, one question about where they are.";
/**
 * A finished batch as an older core left it (P48: no route creates one any more, decision 0025): its run, its row, and one
 * ready draft per client, each written for that client. The batch screens still read such rows.
 */
async function newBatch(o: { clientIds: number[]; project?: string; body?: (first: string) => string; subject?: string }) {
  const project = o.project ?? "p";
  const at = NOW.toISOString();
  const runId = await repos.runs.start({ project, startedAt: at, finishedAt: at, trigger: "owner", skill: "bulk-agent-drafts", status: "ok" });
  const batchId = handle.db.insert(batches).values({ project, name: "Follow-up", intent: "follow_up", status: "ready", audience: "silent", silentDays: 14, clientIds: JSON.stringify(o.clientIds), total: o.clientIds.length, excluded: "{}", brief: BRIEF, runId, createdAt: at, closedAt: at }).returning({ id: batches.id }).get().id;
  for (const id of o.clientIds) {
    const c = (await repos.clients.get(project, id))!;
    const first = c.name.split(" ")[0]!;
    const body = o.body?.(first) ?? `Hi ${first},\n\nIt has been a while. Anything I can help with?`;
    await repos.drafts.create({ project, clientId: c.id, runId, batchId, subject: o.subject ?? `Checking in, ${first}`, toAddr: c.email, body, tone: "standard", tones: JSON.stringify({ standard: body }), reason: `Silent for a while; ${first} asked about the commission last time.`, status: "ready" });
  }
  return { batchId, runId, created: o.clientIds.length };
}

describe("batch (read-only)", () => {
  it("lists and reads a batch with its counts and drafts, owed first", async () => {
    const a = await client("p", "a@x.example", { name: "Ana Silva", silent: 30, owed: true });
    const b = await client("p", "b@x.example", { name: "Bo Li", silent: 20 });
    const r = await newBatch({ clientIds: [b, a] });
    const batch = (await repos.batches.get("p", r.batchId))!;
    expect(batch).toMatchObject({ status: "ready", brief: BRIEF, total: 2, excluded: {}, run: { status: "ok" } });
    expect(batch.counts).toEqual({ all: 2, review: 2, checked: 0, hold: 0, done: 0, skipped: 0 });
    const drafts = await repos.batches.drafts("p", r.batchId);
    expect(drafts.map((d) => d.client.name)).toEqual(["Ana Silva", "Bo Li"]);
    expect(drafts[0]!.body).toContain("Hi Ana,");
    expect((await repos.batches.list("p")).map((x) => x.id)).toEqual([r.batchId]);
    expect(await repos.batches.list("other")).toEqual([]);
    expect(await repos.batches.get("other", r.batchId)).toBeNull();
  });

  it("a finished batch draft does not stop the next batch; the Clients list shows the newest draft", async () => {
    const a = await client("p", "a@x.example", { name: "Ana", silent: 30 });
    const first = await newBatch({ clientIds: [a] });
    const [d1] = await repos.batches.drafts("p", first.batchId);
    await repos.drafts.setStatus(d1!.id, "done");
    const second = await newBatch({ clientIds: [a] });
    const list = await repos.clients.list("p");
    expect(list).toHaveLength(1);
    expect(list[0]!.draft?.batchId).toBe(second.batchId);
    expect((await repos.clients.counts("p")).all).toBe(1);
    // the done draft is history: the same client written to again within 7 days is flagged
    const [d2] = await repos.batches.drafts("p", second.batchId);
    expect(d2!.safetyResults.map((s) => s.kind)).toContain("already_sent_recently");
  });
});

describe("review actions", () => {
  async function one(o: Parameters<typeof client>[2] = {}) {
    const id = await client("p", "a@x.example", { name: "Ana", silent: 30, ...o });
    const r = await newBatch({ clientIds: [id] });
    const [d] = await repos.batches.drafts("p", r.batchId);
    return { id, r, d: d! };
  }

  it("Checked, Done, Skip and Undo, each logged; undo goes one step back", async () => {
    const { r, d } = await one();
    expect((await repos.drafts.setChecked(d.id, true))?.checked).toBe(true);
    expect((await repos.batches.get("p", r.batchId))!.counts).toMatchObject({ checked: 1, review: 0 });
    await repos.drafts.setStatus(d.id, "done");
    expect((await repos.batches.get("p", r.batchId))!.counts).toMatchObject({ done: 1, checked: 0 });
    const undone = await repos.batches.undoLast("p", r.batchId);
    expect(undone).toMatchObject({ status: "ready", checked: true });
    await repos.drafts.setStatus(d.id, "skipped");
    expect((await repos.batches.get("p", r.batchId))!.counts).toMatchObject({ skipped: 1 });
    await repos.batches.undoLast("p", r.batchId);
    await repos.drafts.setChecked(d.id, false);
    await repos.batches.undoLast("p", r.batchId); // un-does the un-tick
    expect((await repos.drafts.get(d.id))!.checked).toBe(true);
    expect(await repos.batches.undoLast("p", r.batchId)).toBeNull();
    await expect(repos.drafts.undo(d.id)).rejects.toThrow(/Nothing to undo/);

    const run = (await repos.batches.get("p", r.batchId))!.runId!;
    const summaries = (await repos.runs.events("p", run)).map((e) => e.summary);
    expect(summaries).toEqual([
      "Checked: Ana",
      "Marked done: Ana",
      "Undid the last action: Ana",
      "Skipped: Ana",
      "Undid the last action: Ana",
      "Unchecked: Ana",
      "Undid the last action: Ana",
    ]);
  });

  it("Checked is refused until every safety result that fired is acknowledged", async () => {
    // a draft with a Cc and a risky word fires two amber results
    const id = await client("p", "b@x.example", { name: "Bo", silent: 30 });
    const r = await newBatch({ clientIds: [id], subject: "Commission", body: () => "Hi Bo, about the commission." });
    const [risky] = await repos.batches.drafts("p", r.batchId);
    expect(risky!.safetyResults.map((s) => [s.kind, s.level, s.acked])).toEqual([["risky_word", "amber", false]]);
    await expect(repos.drafts.setChecked(risky!.id, true)).rejects.toMatchObject({ code: "wrong_state" });
    await repos.drafts.acknowledge(risky!.id, "risky_word", true);
    expect((await repos.drafts.setChecked(risky!.id, true))?.checked).toBe(true);
    // withdrawing the acknowledgement clears the tick: a stale tick cannot pass the gate
    expect((await repos.drafts.acknowledge(risky!.id, "risky_word", false))?.checked).toBe(false);
  });

  it("a do-not-contact mark added after the draft shows up red", async () => {
    const { id, r } = await one();
    await repos.clients.setMarks(id, ["do_not_contact"]);
    const [d] = await repos.batches.drafts("p", r.batchId);
    expect(d!.safetyResults).toMatchObject([{ kind: "do_not_contact", level: "red", acked: false }]);
    await expect(repos.drafts.setChecked(d!.id, true)).rejects.toBeInstanceOf(RepoError);
  });

  it("changing the tone clears Checked and needs an existing version", async () => {
    const { d } = await one();
    await repos.drafts.setChecked(d.id, true);
    await expect(repos.drafts.setTone(d.id, "short")).rejects.toThrow(/no "short" version/);
    expect((await repos.drafts.get(d.id))!.checked).toBe(true);
  });

  it("refuses to reopen a draft while the client has another open one", async () => {
    const { id, d } = await one();
    await repos.drafts.setStatus(d.id, "done");
    await repos.drafts.create({ project: "p", clientId: id, subject: "n", toAddr: "a@x.example", body: "n" });
    await expect(repos.drafts.setStatus(d.id, "ready")).rejects.toThrow(/another open draft/);
  });
});

describe("agent_events retention", () => {
  it("clears detail older than 90 days, keeps summaries and rows, and is idempotent", async () => {
    const run = await repos.runs.start({ project: "p", startedAt: daysAgo(200), trigger: "schedule", skill: "x", status: "ok" });
    const ev = (days: number, detail: string | null) => repos.runs.addEvent({ project: "p", runId: run, at: daysAgo(days), kind: "thought", summary: `s${days}`, detail });
    await ev(120, '{"text":"old"}');
    await ev(91, '{"text":"edge"}');
    await ev(89, '{"text":"new"}');
    await ev(150, null);
    expect(await repos.runs.pruneDetail(90, NOW)).toBe(2);
    expect(await repos.runs.pruneDetail(90, NOW)).toBe(0);
    const rows = await repos.runs.events("p", run);
    expect(rows.map((r) => [r.summary, r.detail === null])).toEqual([["s120", true], ["s91", true], ["s89", false], ["s150", true]]);
  });
});

describe("draft-only invariant (repository)", () => {
  it("cannot set sent, by type or at run time, and cannot change a sent draft", async () => {
    const id = await client("p", "a@x.example", { draft: "ready" });
    const d = (await repos.clients.list("p"))[0]!.draft!;
    // @ts-expect-error `sent` is not a SettableStatus
    await expect(repos.drafts.setStatus(d.id, "sent")).rejects.toMatchObject({ code: "wrong_state" });
    const sent = await repos.drafts.create({ project: "p", clientId: await client("p", "s@x.example"), subject: "s", toAddr: "s@x.example", body: "b", status: "sent" });
    await expect(repos.drafts.setStatus(sent, "ready")).rejects.toThrow(/sent draft cannot change/);
    expect(id).toBeGreaterThan(0);
  });

});

describe("safety rules (data)", () => {
  const base = { draft: { subject: "Hello", toAddr: "a@x.example", ccAddr: null, body: "Hi Ana,\n\nThanks.", mailRef: null }, client: { email: "a@x.example", repliesOwed: false, marks: [] }, lastClosedAt: null, now: NOW };
  const rules = [...DEFAULT_SAFETY_RULES];
  const kinds = (over: object, r = rules) => evaluateSafety({ ...base, ...over } as never, r).map((x) => x.kind);

  it("a clean draft fires nothing", () => expect(kinds({})).toEqual([]));

  it("each rule fires on its own case", () => {
    expect(kinds({ draft: { ...base.draft, ccAddr: "boss@x.example" } })).toEqual(["cc_present"]);
    expect(kinds({ draft: { ...base.draft, toAddr: "other@x.example" } })).toEqual(["unknown_recipients"]);
    expect(kinds({ draft: { ...base.draft, body: "The HOA fee and the pricing sheet." } })).toEqual(["risky_word"]);
    expect(kinds({ draft: { ...base.draft, body: "The whoa moment" } })).toEqual([]); // whole words only
    expect(kinds({ draft: { ...base.draft, body: "Hi [Sam: add the price here]," } })).toEqual(["unresolved_marker"]);
    expect(kinds({ draft: { ...base.draft, subject: "Hi {first_name}" } })).toEqual(["unresolved_marker"]);
    expect(kinds({ client: { ...base.client, repliesOwed: true } })).toEqual(["wrong_thread"]);
    expect(kinds({ client: { ...base.client, repliesOwed: true }, draft: { ...base.draft, mailRef: "<m1@x>" } })).toEqual([]);
    expect(kinds({ client: { ...base.client, marks: ["do_not_contact"] } })).toEqual(["do_not_contact"]);
    expect(kinds({ lastClosedAt: daysAgo(3) })).toEqual(["already_sent_recently"]);
    expect(kinds({ lastClosedAt: daysAgo(10) })).toEqual([]);
  });

  it("the owner can switch a rule off, change its words and its level", async () => {
    await repos.safetyRules.set("p", "cc_present", { enabled: false });
    await repos.safetyRules.set("p", "risky_word", { level: "red", params: { words: ["moon"] } });
    const effective = await repos.safetyRules.list("p");
    expect(effective.find((r) => r.kind === "cc_present")?.enabled).toBe(false);
    expect(effective.find((r) => r.kind === "risky_word")).toMatchObject({ level: "red", params: { words: ["moon"] } });
    expect((await repos.safetyRules.list("other")).find((r) => r.kind === "cc_present")?.enabled).toBe(true);
    const out = evaluateSafety({ ...base, draft: { ...base.draft, ccAddr: "b@x.example", body: "Over the moon" } } as never, effective);
    expect(out.map((x) => [x.kind, x.level])).toEqual([["risky_word", "red"]]);
  });
});

describe("markSent (the Sent reader's write)", () => {
  const seen = { at: "2026-11-14T10:00:00.000Z", via: "message-id", messageId: "<s1@x>" };
  const batchDraft = async (email: string, status: "ready" | "hold" | "done" | "skipped" = "ready") => {
    const c = await client("p", email, { silent: 30 });
    const b = await newBatch({ clientIds: [c] });
    const [d] = await repos.batches.drafts("p", b.batchId);
    if (status !== "ready") await repos.drafts.setStatus(d!.id, status);
    return d!.id;
  };

  it("marks a ready, hold or done draft sent, keeps what was seen, and has no undo", async () => {
    for (const s of ["ready", "hold", "done"] as const) {
      const id = await batchDraft(`${s}@x.example`, s);
      const d = await repos.drafts.markSent(id, seen);
      expect(d).toMatchObject({ status: "sent", sentAt: seen.at, sentVia: "message-id", sentMessageId: "<s1@x>", prevStatus: null });
      await expect(repos.drafts.undo(id)).rejects.toThrow(/Nothing to undo/);
      await expect(repos.drafts.setStatus(id, "ready")).rejects.toThrow(/sent draft cannot change/);
    }
  });

  it("is idempotent, refuses skipped and unknown drafts, and frees the client for a new draft", async () => {
    const id = await batchDraft("a@x.example");
    const first = await repos.drafts.markSent(id, seen);
    expect(await repos.drafts.markSent(id, { ...seen, messageId: "<other@x>" })).toMatchObject({ sentMessageId: first!.sentMessageId });
    expect(await repos.drafts.markSent(id + 999, seen)).toBeNull();
    const skipped = await batchDraft("b@x.example", "skipped");
    expect(await repos.drafts.markSent(skipped, seen)).toBeNull();
    const c = (await repos.clients.list("p")).find((x) => x.email === "a@x.example")!;
    await expect(repos.drafts.create({ project: "p", clientId: c.id, subject: "n", toAddr: "a@x.example", body: "b" })).resolves.toBeGreaterThan(0);
  });

  it("awaitingSent lists open and done drafts of the project since a date (batch or recorded), not sent or skipped ones", async () => {
    const a = await batchDraft("a@x.example");
    const b = await batchDraft("b@x.example", "done");
    await batchDraft("c@x.example", "skipped");
    const s = await batchDraft("d@x.example");
    await repos.drafts.markSent(s, seen);
    const loose = await client("p", "e@x.example", { draft: "ready" }); // recorded, not in a batch: reconciled too
    expect(loose).toBeGreaterThan(0);
    const ids = (await repos.drafts.awaitingSent("p", "2000-01-01T00:00:00.000Z")).map((d) => d.id);
    expect(ids).toHaveLength(3);
    expect(ids).toEqual(expect.arrayContaining([a, b]));
    expect(await repos.drafts.awaitingSent("p", "2999-01-01T00:00:00.000Z")).toEqual([]);
    expect(await repos.drafts.awaitingSent("other", "2000-01-01T00:00:00.000Z")).toEqual([]);
  });
});

describe("a batch as a scope of the Drafts list (P27)", () => {
  it("lists exactly the drafts the batch wrote, and counts them, not every client's latest draft", async () => {
    const a = await client("p", "a@x.example", { name: "Ann", silent: 30 });
    await client("p", "b@x.example", { name: "Bo", silent: 20, draft: "ready" });
    await client("p", "c@x.example", { name: "Cy", silent: 25 });
    const { batchId } = await newBatch({ clientIds: [a] });
    const rows = await repos.clients.review("p", "all", { batch: batchId });
    expect(rows.map((d) => d.client.name)).toEqual(["Ann"]);
    expect(await repos.clients.reviewTotal("p", "all", { batch: batchId })).toBe(1);
    expect((await repos.clients.counts("p", { batch: batchId })).all).toBe(1);
    expect((await repos.clients.counts("p")).all).toBe(2); // the project list: Ann's batch draft and Bo's open one
    expect(await repos.clients.review("p", "all", { batch: batchId, search: "bo" })).toEqual([]);
  });
});

describe("a bulk-drafts run is one batch in Drafts (P85)", () => {
  const rec = (email: string, mailRef: string, batchKey = "bulk-2026-11-20-1200-abc") =>
    repos.drafts.record({ project: "p", email, name: email.split("@")[0]!, subject: "Re: Hello", mailRef, skill: "bulk-drafts", ownerRequest: "write to every client about the new price list", evidence: { level: "ok", source: "observed", findings: [], context: { purpose: "price list" }, batchKey } });

  it("the run's first written draft makes the batch, the rest join it, a rerun adds nobody twice", async () => {
    const a = await rec("ann@x.example", "<a1@x>");
    const b = await rec("bob@x.example", "<b1@x>");
    const again = await rec("ann@x.example", "<a1@x>");
    expect(again).toMatchObject({ action: "updated", draftId: a.draftId });
    const list = await repos.batches.list("p");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "write to every client about the new price list", brief: "write to every client about the new price list", intent: "custom", audience: "agent", total: 2, runId: a.runId });
    expect(list[0]!.counts.all).toBe(2);
    expect((await repos.drafts.get(a.draftId))?.batchId).toBe(list[0]!.id);
    expect((await repos.drafts.get(b.draftId))?.batchId).toBe(list[0]!.id);
    // A message on the owner's initiative owes the client no reply: not in the triage list's "owed".
    expect((await repos.inbox.list("p", "owed")).map((r) => r.email)).not.toContain("ann@x.example");
    // Another run is another batch; a triage record with a batchKey is no batch.
    await rec("cy@x.example", "<c1@x>", "bulk-2026-11-21-0900-xyz");
    await repos.drafts.record({ project: "p", email: "dee@x.example", name: "Dee", subject: "Re: Q", mailRef: "<d1@x>", skill: "triage-mail", evidence: { level: "ok", source: "observed", findings: [], batchKey: "triage-1" } });
    expect((await repos.batches.list("p")).map((x) => x.total)).toEqual([1, 2]);
  });

  it("a finished draft with the same message is not a batch member again unless the owner's words wrote a new one", async () => {
    const a = await rec("ann@x.example", "<a1@x>");
    await repos.drafts.setStatus(a.draftId, "done");
    const b = await rec("ann@x.example", "<a1@x>");
    expect(b.action).toBe("created");
    expect(b.draftId).not.toBe(a.draftId);
  });
});
