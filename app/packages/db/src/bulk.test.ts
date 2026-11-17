import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SAFETY_RULES } from "@hub/config";
import { openDb, type DbHandle } from "./client";
import { RepoError } from "./errors";
import { createRepos, type Repos } from "./repos";
import { evaluateSafety } from "./safety";

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
const createBatch = (over: Partial<Parameters<Repos["batches"]["create"]>[0]> & { clientIds: number[] }) =>
  repos.batches.create({ project: "p", name: "Follow-up", intent: "follow_up", audience: "silent", silentDays: 14, brief: BRIEF, ...over }, { now: NOW });
/**
 * What the agent does with a queued batch (P28 C5): one draft per client, each written for that client, then it closes the
 * batch. The hub itself never fills a body from one text. `newBatch` is a batch the agent has already finished.
 */
async function agentFinishes(batchId: number, project = "p"): Promise<number> {
  const queued = (await repos.batches.queuedAgent([project])).find((b) => b.id === batchId)!;
  for (const c of queued.clients) {
    const first = c.name.split(" ")[0]!;
    await repos.batches.addAgentDraft(project, batchId, { clientId: c.id, subject: `Checking in, ${first}`, body: `Hi ${first},\n\nIt has been a while. Anything I can help with?`, reason: `Silent for a while; ${first} asked about the commission last time.` });
  }
  await repos.batches.close(project, batchId, { status: "ready" });
  return queued.clients.length;
}
const newBatch = async (over: Partial<Parameters<Repos["batches"]["create"]>[0]> & { clientIds: number[] }) => {
  const r = await createBatch(over);
  return { ...r, created: await agentFinishes(r.batchId, over.project ?? "p") };
};

describe("audience", () => {
  it("counts every chip and marks who cannot be written to", async () => {
    await client("p", "a@x.example", { silent: 30, owed: true });
    await client("p", "b@x.example", { silent: 20, marks: ["vip"] });
    await client("p", "c@x.example", { silent: 2, marks: ["follow_up"] });
    await client("p", "d@x.example", { silent: 40, marks: ["do_not_contact"] });
    await client("p", "e@x.example", { silent: 25, draft: "ready" });
    await client("other", "z@x.example", { silent: 99 });

    const a = await repos.batches.audience("p", { audience: "silent", silentDays: 14, now: NOW });
    expect(a.counts).toEqual({ all: 5, owed: 1, silent: 4, follow_up: 1, vip: 1 });
    expect(a.clients.map((c) => [c.email, c.reason])).toEqual([
      ["a@x.example", null],
      ["d@x.example", "do_not_contact"],
      ["e@x.example", "open_draft"],
      ["b@x.example", null],
    ]);
    expect(a.eligible).toBe(2);
  });
});

describe("batch", () => {
  it("queues with the owner's brief and no draft: the hub writes no body, the agent does, and the run logs it", async () => {
    const a = await client("p", "a@x.example", { name: "Ana Silva", silent: 30, owed: true });
    const b = await client("p", "b@x.example", { name: "Bo Li", silent: 20 });
    const dnc = await client("p", "d@x.example", { silent: 40, marks: ["do_not_contact"] });
    const open = await client("p", "e@x.example", { silent: 25, draft: "hold" });
    const r = await createBatch({ clientIds: [a, b, dnc, open, 9999] });
    expect(r).toEqual({ batchId: expect.any(Number), excluded: { do_not_contact: 1, open_draft: 1, not_in_project: 1 } });

    const batch = (await repos.batches.get("p", r.batchId))!;
    expect(batch).toMatchObject({ status: "queued", brief: BRIEF, total: 2, excluded: { do_not_contact: 1, open_draft: 1, not_in_project: 1 } });
    expect(batch.counts).toEqual({ all: 0, review: 0, checked: 0, hold: 0, done: 0, skipped: 0 });
    expect(await repos.batches.drafts("p", r.batchId)).toEqual([]);

    expect(await agentFinishes(r.batchId)).toBe(2);
    const drafts = await repos.batches.drafts("p", r.batchId);
    expect(drafts.map((d) => d.client.name)).toEqual(["Ana Silva", "Bo Li"]); // owed first
    expect(drafts.every((d) => d.status === "ready" && !d.checked && d.batchId === r.batchId)).toBe(true);
    expect(drafts[0]).toMatchObject({ subject: "Checking in, Ana", toAddr: "a@x.example", tone: "standard" });
    expect(drafts[0]!.body).toContain("Hi Ana,");
    expect(drafts[1]!.body).toContain("Hi Bo,");

    const events = await repos.runs.events("p", batch.runId!);
    expect(events.map((e) => e.kind)).toEqual(["decision", "draft_created", "draft_created", "decision"]);
    expect(events[0]!.summary).toMatch(/2 clients selected, 3 left out\. Waiting for the agent/);
  });

  it("refuses an empty selection and a batch with no brief", async () => {
    const dnc = await client("p", "d@x.example", { marks: ["do_not_contact"] });
    await expect(createBatch({ clientIds: [dnc] })).rejects.toBeInstanceOf(RepoError);
    const ok = await client("p", "a@x.example");
    await expect(createBatch({ clientIds: [ok], brief: " " })).rejects.toThrow(/needs a brief/);
  });

  it("scopes a batch to its project", async () => {
    const other = await client("other", "z@x.example");
    await expect(newBatch({ clientIds: [other] })).rejects.toThrow(/No eligible/);
    expect(await repos.batches.list("other")).toEqual([]);
  });

  it("a finished batch draft does not stop the next batch; the Clients list shows the newest draft", async () => {
    const a = await client("p", "a@x.example", { name: "Ana", silent: 30 });
    const first = await newBatch({ clientIds: [a] });
    const [d1] = await repos.batches.drafts("p", first.batchId);
    await repos.drafts.setStatus(d1!.id, "done");
    const second = await newBatch({ clientIds: [a] });
    expect(second.created).toBe(1);
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
    const summaries = (await repos.runs.events("p", run)).slice(3).map((e) => e.summary);
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
    const r = await createBatch({ name: "Risky", intent: "notice", audience: "all", clientIds: [id] });
    await repos.batches.addAgentDraft("p", r.batchId, { clientId: id, subject: "Commission", body: "Hi Bo, about the commission.", reason: "Asked about it." });
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

describe("agent batch (the agent adds drafts)", () => {
  it("queues, takes drafts only for selected clients, then closes with the run's cost", async () => {
    const a = await client("p", "a@x.example", { name: "Ana", silent: 30 });
    const b = await client("p", "b@x.example", { name: "Bo", silent: 20 });
    const stranger = await client("p", "s@x.example", { silent: 5 });
    const r = await createBatch({ name: "Agent", intent: "notice", clientIds: [a, b], brief: "Tell them about the new office." });
    let batch = (await repos.batches.get("p", r.batchId))!;
    expect(batch).toMatchObject({ status: "queued", total: 2, brief: "Tell them about the new office." });
    expect(batch.run?.finishedAt).toBeNull();

    const draft = { subject: "News", body: "Hi Ana, we moved.", reason: "Silent 30 days; the office news is relevant.", tones: { short: "We moved.", warm: "Hi Ana, we moved, and I would love to show you." } };
    const id = await repos.batches.addAgentDraft("p", r.batchId, { clientId: a, ...draft });
    expect((await repos.drafts.get(id))).toMatchObject({ status: "ready", checked: false, tone: "standard", batchId: r.batchId });
    expect((await repos.batches.drafts("p", r.batchId))[0]!.toneBodies).toEqual({ short: "We moved.", warm: draft.tones.warm, standard: draft.body });
    await expect(repos.batches.addAgentDraft("p", r.batchId, { clientId: a, ...draft })).rejects.toThrow(/already has a draft/);
    await expect(repos.batches.addAgentDraft("p", r.batchId, { clientId: stranger, ...draft })).rejects.toThrow(/not in this batch/);
    await expect(repos.batches.addAgentDraft("p", 999, { clientId: a, ...draft })).rejects.toMatchObject({ code: "not_found" });

    // tones the agent wrote can be shown; showing one clears Checked
    await repos.drafts.setChecked(id, true);
    expect((await repos.drafts.setTone(id, "short"))).toMatchObject({ body: "We moved.", tone: "short", checked: false });

    await repos.batches.close("p", r.batchId, { status: "ready", tokensIn: 1200, tokensOut: 300, costUsd: 0.04, model: "sonnet" });
    batch = (await repos.batches.get("p", r.batchId))!;
    expect(batch.status).toBe("ready");
    expect(batch.run).toMatchObject({ status: "ok", costUsd: 0.04, tokensIn: 1200 });
    expect(batch.counts.all).toBe(1);
    await expect(repos.batches.addAgentDraft("p", r.batchId, { clientId: b, ...draft })).rejects.toThrow(/not waiting/);
    await expect(repos.batches.close("p", r.batchId, { status: "ready" })).rejects.toThrow(/already closed/);
  });
});

describe("queued agent batches (what the gate hands to a run)", () => {
  it("lists queued agent batches with the clients still without a draft, never do-not-contact, scoped by project", async () => {
    const a = await client("p", "a@x.example", { silent: 30 });
    const b = await client("p", "b@x.example", { silent: 20 });
    const z = await client("q", "z@x.example", { silent: 20 });
    const mk = (project: string, ids: number[]) => repos.batches.create({ project, name: `B-${project}`, intent: "notice", audience: "all", clientIds: ids, brief: "Say hello." }, { now: NOW });
    const rp = await mk("p", [a, b]);
    await mk("q", [z]);

    let all = await repos.batches.queuedAgent();
    expect(all.map((x) => [x.project, x.name])).toEqual([["p", "B-p"], ["q", "B-q"]]);
    expect((await repos.batches.queuedAgent(["q"])).map((x) => x.project)).toEqual(["q"]);
    expect(await repos.batches.queuedAgent([])).toEqual([]);
    expect(all[0]).toMatchObject({ id: rp.batchId, brief: "Say hello.", total: 2 });
    expect(all[0]!.clients.map((c) => c.email).sort()).toEqual(["a@x.example", "b@x.example"]);

    await repos.batches.addAgentDraft("p", rp.batchId, { clientId: a, subject: "s", body: "b", reason: "r" });
    await repos.clients.setMarks(b, ["do_not_contact"]);
    all = await repos.batches.queuedAgent(["p"]);
    expect(all[0]!.clients).toEqual([]);

    await repos.batches.close("p", rp.batchId, { status: "ready" });
    expect(await repos.batches.queuedAgent(["p"])).toEqual([]);
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

  it("no batch path writes sent: agent drafts are always ready", async () => {
    const a = await client("p", "a@x.example", { silent: 30 });
    const t = await newBatch({ clientIds: [a] });
    expect((await repos.batches.drafts("p", t.batchId)).map((d) => d.status)).toEqual(["ready"]);
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
