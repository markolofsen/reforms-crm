import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DbHandle } from "../src/client";
import { adoptable, createRepos, isReplyShell, shellHashOf, startsWithWrite, textKey, versionHashOf, type Repos } from "../src/repos";
import { eq } from "drizzle-orm";
import { readFixtures, seed } from "../src/seed";
import { clients } from "../src/schema";

let handle: DbHandle;
let repos: Repos;

beforeEach(() => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
});
afterEach(() => handle.close());

async function addClient(
  project: string,
  email: string,
  o: { owed?: boolean; last?: string; status?: "ready" | "hold" | "done" | "sent" } = {},
) {
  const clientId = await repos.clients.create({
    project,
    email,
    name: email.split("@")[0]!,
    repliesOwed: o.owed ?? false,
    lastContactAt: o.last === "none" ? null : (o.last ?? "2026-11-01T00:00:00.000Z"),
  });
  let draftId: number | null = null;
  if (o.status) {
    draftId = await repos.drafts.create({ project, clientId, subject: "Re: x", toAddr: email, body: "b", status: o.status });
  }
  return { clientId, draftId };
}

describe("clients list and counts", () => {
  it("lists only clients with a draft, owed first, then longest silence; finished rows last", async () => {
    await addClient("p", "done@x.example", { owed: true, status: "done" });
    await addClient("p", "quiet@x.example", { last: "2026-10-01T00:00:00.000Z", status: "ready" });
    await addClient("p", "recent@x.example", { status: "ready" });
    await addClient("p", "owed@x.example", { owed: true, status: "ready" });
    await addClient("p", "no-draft@x.example", { owed: true });
    const order = (await repos.clients.list("p")).map((c) => c.email);
    expect(order).toEqual(["owed@x.example", "quiet@x.example", "recent@x.example", "done@x.example"]);
  });

  it("an unknown last contact sorts after a known one, owed still first (P27 M1.2)", async () => {
    await addClient("p", "unknown@x.example", { last: "none", status: "ready" });
    await addClient("p", "old@x.example", { last: "2026-01-01T00:00:00.000Z", status: "ready" });
    await addClient("p", "owed-unknown@x.example", { last: "none", owed: true, status: "ready" });
    const expected = ["owed-unknown@x.example", "old@x.example", "unknown@x.example"];
    expect((await repos.clients.list("p")).map((c) => c.email)).toEqual(expected);
    expect((await repos.clients.review("p")).map((d) => d.client.email)).toEqual(expected);
  });

  it("filters and counts agree, and are scoped to the project", async () => {
    await addClient("p", "a@x.example", { owed: true, status: "ready" });
    await addClient("p", "b@x.example", { owed: true, status: "hold" });
    await addClient("p", "c@x.example", { owed: true, status: "done" });
    await addClient("p", "d@x.example", { status: "sent" });
    await addClient("p", "e@x.example", {});
    await addClient("other", "z@x.example", { owed: true, status: "ready" });

    const counts = await repos.clients.counts("p");
    expect(counts).toEqual({ all: 4, ready: 1, hold: 1, owed: 2, done: 1, sent: 1, skipped: 0, thin_basis: 0, sequences: 0 });
    for (const [filter, n] of Object.entries(counts)) {
      expect(await repos.clients.list("p", filter as keyof typeof counts)).toHaveLength(n);
    }
    // a client with no draft is not owed in the Drafts list
    await addClient("p", "f@x.example", { owed: true });
    expect((await repos.clients.counts("p")).owed).toBe(2);
    expect((await repos.clients.counts("other")).all).toBe(1);
    expect(await repos.projects.list()).toEqual(["other", "p"]);
  });
});

describe("P99 S0 (e): one client's drafts in All", () => {
  it("are newest first", async () => {
    const { clientId, draftId: first } = await addClient("p", "me@x.example", { status: "done" });
    const second = await repos.drafts.create({ project: "p", clientId, subject: "Re: y", toAddr: "me@x.example", body: "b", status: "sent" });
    const third = await repos.drafts.create({ project: "p", clientId, subject: "Re: z", toAddr: "me@x.example", body: "b", status: "done" });
    expect((await repos.clients.review("p", "all")).map((d) => d.id)).toEqual([third, second, first]);
  });

  it("leave two clients that tie in their order (the older client first)", async () => {
    const { draftId: older } = await addClient("p", "a@x.example", { owed: true, status: "ready" });
    const { draftId: newer } = await addClient("p", "b@x.example", { owed: true, status: "ready" });
    expect((await repos.clients.review("p", "all")).map((d) => d.id)).toEqual([older, newer]);
  });
});

describe("drafts and marks", () => {
  it("ticks Checked and marks done; unknown ids return null", async () => {
    const { draftId, clientId } = await addClient("p", "a@x.example", { status: "ready" });
    expect((await repos.drafts.setChecked(draftId!, true))?.checked).toBe(true);
    expect((await repos.drafts.setChecked(draftId!, false))?.checked).toBe(false);
    expect((await repos.drafts.setStatus(draftId!, "done"))?.status).toBe("done");
    expect((await repos.clients.list("p", "done"))[0]?.draft?.id).toBe(draftId);
    expect(await repos.drafts.setChecked(9999, true)).toBeNull();
    expect(await repos.drafts.setStatus(9999, "done")).toBeNull();
    expect(clientId).toBeGreaterThan(0);
  });

  it("replaces marks and refuses an unknown client", async () => {
    const { clientId } = await addClient("p", "a@x.example", { status: "ready" });
    expect(await repos.clients.setMarks(clientId, ["vip", "follow_up", "vip"])).toBe(true);
    expect((await repos.clients.list("p"))[0]?.marks.sort()).toEqual(["follow_up", "vip"]);
    await repos.clients.setMarks(clientId, []);
    expect((await repos.clients.list("p"))[0]?.marks).toEqual([]);
    expect(await repos.clients.setMarks(9999, ["vip"])).toBe(false);
  });

  it("allows one draft per client", async () => {
    const { clientId } = await addClient("p", "a@x.example", { status: "ready" });
    await expect(
      repos.drafts.create({ project: "p", clientId, subject: "s", toAddr: "a@x.example", body: "b" }),
    ).rejects.toThrow();
  });
});

describe("agent log", () => {
  it("numbers events per run and reads them back in order, scoped by project", async () => {
    const run = await repos.runs.start({ project: "p", startedAt: "2026-11-14T10:00:00.000Z", trigger: "schedule" });
    const other = await repos.runs.start({ project: "p", startedAt: "2026-11-14T09:00:00.000Z", trigger: "owner" });
    await repos.runs.addEvent({ project: "p", runId: run, at: "2026-11-14T10:00:01.000Z", kind: "thought", summary: "one" });
    await repos.runs.addEvent({ project: "p", runId: run, at: "2026-11-14T10:00:02.000Z", kind: "decision", summary: "two", detail: "{}" });
    await repos.runs.addEvent({ project: "p", runId: other, at: "2026-11-14T09:00:01.000Z", kind: "error", summary: "x" });
    await repos.runs.finish(run, { status: "needs_human", costUsd: 0.2 });

    const events = await repos.runs.events("p", run);
    expect(events.map((e) => [e.seq, e.summary])).toEqual([[1, "one"], [2, "two"]]);
    expect(await repos.runs.events("elsewhere", run)).toEqual([]);
    // Activity (P73) lists client decisions only: a thought, an error and a decision with no outcome are the session log's.
    expect((await repos.runs.activity("p")).rows).toEqual([]);
    expect((await repos.runs.activity("elsewhere")).rows).toEqual([]);
  });
});

describe("seed", () => {
  it("reads invented senders from the fixtures", () => {
    const mails = readFixtures();
    expect(mails.map((m) => m.email)).toContain("anna@example.com");
    expect(mails.every((m) => m.email.includes("example."))).toBe(true);
    expect(mails.find((m) => m.email === "ivan@example.com")?.name).toBe("Иван Тестов");
  });

  it("fills two projects once and is idempotent", async () => {
    expect(await seed(repos, { now: new Date("2026-11-14T12:00:00Z") })).toBe(true);
    expect(await seed(repos)).toBe(false);
    expect(await repos.projects.list()).toEqual(["demo-shop", "lisbon-realty"]);
    const counts = await repos.clients.counts("lisbon-realty");
    expect(counts.all).toBeGreaterThan(5);
    expect((await repos.runs.activity("lisbon-realty")).counts.all).toBeGreaterThan(3);
    // the same address lives in both projects without clashing
    expect((await repos.clients.list("demo-shop")).some((c) => c.email === "anna@example.com")).toBe(true);
    expect((await repos.clients.list("lisbon-realty")).some((c) => c.email === "anna@example.com")).toBe(true);
  });
});

describe("clients.upsert", () => {
  it("inserts once and refreshes the same (project, email) without duplicating", async () => {
    const handle = openDb(":memory:");
    const repos = createRepos(handle.db);
    const base = { project: "acme", email: "a@example.com", name: "A", repliesOwed: false, lastContactAt: null };
    const first = await repos.clients.upsert(base);
    const second = await repos.clients.upsert({ ...base, name: "A Renamed", repliesOwed: true });
    expect(second.id).toBe(first.id);
    const rows = handle.db.select().from(clients).where(eq(clients.project, "acme")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "A Renamed", repliesOwed: true });
    handle.close();
  });
});

describe("clients.touch", () => {
  it("inserts, then changes only the columns it is given, and keeps marks and drafts", async () => {
    const { id, created } = await repos.clients.touch({ project: "p", email: "Ann@x.example", name: "Ann", repliesOwed: true, lastContactAt: "2026-11-01T00:00:00.000Z" });
    expect(created).toBe(true);
    await repos.clients.setMarks(id, ["vip"]);
    const draftId = await repos.drafts.create({ project: "p", clientId: id, subject: "s", toAddr: "ann@x.example", body: "" });
    const again = await repos.clients.touch({ project: "p", email: "ann@x.example", name: "Ann Lee" });
    expect(again).toEqual({ id, created: false });
    const [row] = await repos.clients.list("p");
    expect(row).toMatchObject({ name: "Ann Lee", repliesOwed: true, lastContactAt: "2026-11-01T00:00:00.000Z", marks: ["vip"] });
    expect(row?.draft?.id).toBe(draftId);
    await repos.clients.touch({ project: "p", email: "ann@x.example", name: "Ann Lee", repliesOwed: false });
    expect((await repos.clients.list("p"))[0]?.repliesOwed).toBe(false);
  });
});

describe("drafts.record", () => {
  const input = { project: "p", email: "Cy@x.example", name: "Cy Roe", subject: "Re: terms", mailRef: "<m1@x.example>" };

  it("creates the client, the draft, the run and the log line in one go", async () => {
    const r = await repos.drafts.record({ ...input, reason: "They asked for terms.", notion: { kind: "client", pageId: "0123456789abcdef0123456789abcdef", url: "https://notion.so/cy" }, skill: "triage-mail", marks: ["follow_up"], repliesOwed: true });
    expect(r.action).toBe("created");
    const d = (await repos.drafts.get(r.draftId))!;
    expect(d).toMatchObject({ project: "p", clientId: r.clientId, runId: r.runId, batchId: null, status: "ready", body: "", toAddr: "cy@x.example", mailRef: "<m1@x.example>", notionKind: "client", notionPageId: "0123456789abcdef0123456789abcdef", notionUrl: "https://notion.so/cy" });
    const [c] = await repos.clients.list("p");
    expect(c).toMatchObject({ email: "cy@x.example", name: "Cy Roe", repliesOwed: true, marks: ["follow_up"] });
    const events = await repos.runs.events("p", r.runId);
    expect(events.map((e) => [e.kind, e.summary])).toEqual([["draft_created", "Draft recorded: Cy Roe"]]);
    expect((await repos.runs.activity("p")).rows[0]).toMatchObject({ outcome: "drafted", skill: "triage-mail", draftId: r.draftId, why: "They asked for terms." });
  });

  it("the same mailRef again updates in place: one row", async () => {
    const a = await repos.drafts.record(input);
    const b = await repos.drafts.record({ ...input, subject: "Re: terms (v2)", reason: "Edited." });
    expect(b).toMatchObject({ action: "updated", draftId: a.draftId, clientId: a.clientId });
    expect(await repos.clients.list("p")).toHaveLength(1);
    expect((await repos.drafts.get(a.draftId))).toMatchObject({ subject: "Re: terms (v2)", reason: "Edited." });
    expect((await repos.clients.counts("p")).all).toBe(1);
  });

  it("another mailRef skips the open draft and inserts: history kept, the unique index is not tripped", async () => {
    const a = await repos.drafts.record(input);
    const b = await repos.drafts.record({ ...input, mailRef: "<m2@x.example>", subject: "Re: terms 2" });
    expect(b.action).toBe("replaced");
    expect(b.draftId).not.toBe(a.draftId);
    expect(await repos.drafts.get(a.draftId)).toMatchObject({ status: "skipped", prevStatus: "ready" });
    expect(await repos.drafts.get(b.draftId)).toMatchObject({ status: "ready" });
    const [row] = await repos.clients.list("p");
    expect(row?.draft?.id).toBe(b.draftId);
    const events = await repos.runs.events("p", b.runId);
    expect(events.map((e) => e.summary)).toEqual(["Replaced by a newer draft: Cy Roe", "Draft recorded: Cy Roe"]);
  });

  it("does not bring back a finished draft of the same message", async () => {
    const a = await repos.drafts.record(input);
    await repos.drafts.setStatus(a.draftId, "done");
    const b = await repos.drafts.record(input);
    expect(b).toMatchObject({ action: "unchanged", draftId: a.draftId });
    expect((await repos.drafts.get(a.draftId))!.status).toBe("done");
  });

  it("P99 S0 (b): the unchanged answer says it recorded nothing; a written record says recorded", async () => {
    const a = await repos.drafts.record(input);
    expect(a).toMatchObject({ action: "created", recorded: true });
    await repos.drafts.setStatus(a.draftId, "done");
    const b = await repos.drafts.record({ ...input, reason: "a poem" });
    expect(b).toMatchObject({ action: "unchanged", recorded: false, draftId: a.draftId });
    expect(b.message).toMatch(/^Not recorded: draft \d+ is done .*nothing was recorded.*ownerRequest/);
    expect((await repos.drafts.get(a.draftId))!.reason).toBeNull();
  });

  it("P99 S0 (c): a revision may replace the recorded reason; omitted, it stays", async () => {
    const a = await repos.drafts.record({ ...input, reason: "First reason." });
    await repos.drafts.revised("p", a.draftId, { excerpt: "v2", wroteTo: null, brand: null });
    expect(await repos.drafts.get(a.draftId)).toMatchObject({ body: "v2", reason: "First reason." });
    await repos.drafts.revised("p", a.draftId, { excerpt: "v3", wroteTo: null, brand: null, reason: "  They asked for the offer.  " });
    expect(await repos.drafts.get(a.draftId)).toMatchObject({ body: "v3", reason: "They asked for the offer." });
  });

  it("P99 S0 (e2): Done on a skipped draft and Skip on a done one are refused; Reopen first", async () => {
    const a = await repos.drafts.record(input);
    await repos.drafts.setStatus(a.draftId, "skipped");
    await expect(repos.drafts.setStatus(a.draftId, "done")).rejects.toThrow(/is skipped: Reopen or Undo it first/);
    expect((await repos.drafts.get(a.draftId))!.status).toBe("skipped");
    await repos.drafts.setStatus(a.draftId, "ready");
    await repos.drafts.setStatus(a.draftId, "done");
    await expect(repos.drafts.setStatus(a.draftId, "skipped")).rejects.toThrow(/is done: Reopen or Undo it first/);
    expect((await repos.drafts.undo(a.draftId))?.status).toBe("ready");
  });

  it("P99 S0 (d): Done, Skip, Hold and Undo of a draft outside a batch are logged, one event each, in one owner run", async () => {
    const a = await repos.drafts.record(input);
    const before = (await repos.runs.eventsForClient("p", a.clientId)).length;
    await repos.drafts.setStatus(a.draftId, "hold");
    await repos.drafts.setStatus(a.draftId, "skipped");
    await repos.drafts.undo(a.draftId);
    await repos.drafts.setStatus(a.draftId, "done");
    const events = (await repos.runs.eventsForClient("p", a.clientId)).slice(0, -before || undefined);
    expect(events.map((e) => e.summary).reverse()).toEqual(["Put on hold: Cy Roe", "Skipped: Cy Roe", "Undid the last action: Cy Roe", "Marked done: Cy Roe"]);
    expect(new Set(events.map((e) => e.runId)).size).toBe(1);
    expect(events[0]!.runId).not.toBe(a.runId);
    expect(JSON.parse(events[0]!.detail ?? "{}")).toMatchObject({ draftId: a.draftId, action: "done" });
    // Skip is a client decision of the Activity screen.
    expect((await repos.runs.activity("p")).rows.map((r) => r.outcome)).toContain("skipped");
    // The run is per project: another project's decision has its own.
    const q = await repos.drafts.record({ ...input, project: "q" });
    await repos.drafts.setStatus(q.draftId, "done");
    const [qe] = await repos.runs.eventsForClient("q", q.clientId);
    expect(qe!.runId).not.toBe(events[0]!.runId);
  });

  it("keeps the owner's marks, records a do-not-contact client, and can log into a given run", async () => {
    const first = await repos.drafts.record({ ...input, marks: ["do_not_contact"] });
    await repos.drafts.record({ ...input, marks: ["vip"] });
    expect((await repos.clients.list("p"))[0]?.marks.sort()).toEqual(["do_not_contact", "vip"]);
    const second = await repos.drafts.record({ ...input, email: "dee@x.example", name: "Dee", mailRef: "<d@x.example>", runId: first.runId });
    expect(second.runId).toBe(first.runId);
    await expect(repos.drafts.record({ ...input, email: "e@x.example", runId: 9999 })).rejects.toThrow(/No such run/);
    await expect(repos.drafts.record({ ...input, email: "f@x.example", marks: ["nope" as "vip"] })).rejects.toThrow(/Unknown mark/);
  });

  it("is scoped to the project: the same address in another project is another client", async () => {
    const a = await repos.drafts.record(input);
    const b = await repos.drafts.record({ ...input, project: "q" });
    expect(b.clientId).not.toBe(a.clientId);
    expect(await repos.clients.list("q")).toHaveLength(1);
  });

  it("awaitingSent returns a recorded draft, and markSent is the only way to `sent`", async () => {
    const a = await repos.drafts.record(input);
    expect((await repos.drafts.awaitingSent("p", "2000-01-01T00:00:00.000Z")).map((d) => d.id)).toEqual([a.draftId]);
    await expect(repos.drafts.setStatus(a.draftId, "sent" as "done")).rejects.toThrow(/never sets/);
    const sent = await repos.drafts.markSent(a.draftId, { at: "2026-11-15T10:00:00.000Z", via: "message-id", messageId: "<s@x>" });
    expect(sent).toMatchObject({ status: "sent", sentMessageId: "<s@x>" });
    expect(await repos.drafts.awaitingSent("p", "2000-01-01T00:00:00.000Z")).toEqual([]);
  });
});

describe("inbox", () => {
  const base = { project: "p", email: "Ann@x.example", name: "Ann", action: "skipped" as const, reason: "newsletter" };

  it("records a row, keeps firstSeenAt on a re-record, and logs one decision line", async () => {
    const a = await repos.inbox.record(base, new Date("2026-11-01T10:00:00Z"));
    const b = await repos.inbox.record({ ...base, action: "escalated", reason: "legal" }, new Date("2026-11-01T10:05:00Z"));
    expect(a.inboxId).toBe(b.inboxId);
    expect(b.created).toBe(false);
    const [row] = await repos.inbox.list("p", "all");
    expect(row).toMatchObject({ email: "ann@x.example", action: "escalated", firstSeenAt: "2026-11-01T10:00:00.000Z", recordedAt: "2026-11-01T10:05:00.000Z", owed: true });
    expect((await repos.runs.events("p", a.runId)).map((e) => e.summary)).toEqual(["Ann: skipped"]);
  });

  it("skipped is not owed; a drafted client with an open draft is not owed either", async () => {
    await repos.inbox.record(base);
    await repos.drafts.record({ project: "p", email: "cy@x.example", name: "Cy", subject: "Re", mailRef: "<c@x>" });
    expect((await repos.inbox.list("p", "owed")).map((r) => r.email)).toEqual([]);
    expect((await repos.inbox.counts("p")).all).toBe(2);
    expect((await repos.inbox.list("p", "all")).find((r) => r.email === "cy@x.example")?.openDraftId).not.toBeNull();
  });

  it("new = the latest triage: records closer together than the gap", async () => {
    await repos.inbox.record({ ...base, email: "old@x.example" }, new Date("2026-11-01T08:00:00Z"));
    await repos.inbox.record({ ...base, email: "n1@x.example" }, new Date("2026-11-02T08:00:00Z"));
    await repos.inbox.record({ ...base, email: "n2@x.example" }, new Date("2026-11-02T08:10:00Z"));
    expect((await repos.inbox.list("p", "new")).map((r) => r.email).sort()).toEqual(["n1@x.example", "n2@x.example"]);
    expect(await repos.inbox.lastTriageAt("p")).toBe("2026-11-02T08:10:00.000Z");
    expect(await repos.inbox.lastTriageAt("other")).toBeNull();
  });

  it("loads Notion references in one project-scoped batch and normalizes addresses", async () => {
    await repos.inbox.record({ ...base, notion: { kind: "client", pageId: "0123456789abcdef0123456789abcdef", url: null } });
    await repos.inbox.record({ ...base, email: "Other@x.example", notion: { kind: "none" } });
    await repos.inbox.record({ ...base, project: "other", notion: { kind: "client", pageId: "fedcba9876543210fedcba9876543210", url: null } });

    const refs = await repos.inbox.notionByEmails("p", [" ANN@X.EXAMPLE ", "other@x.example", "missing@x.example"]);

    expect([...refs.entries()]).toEqual([
      ["ann@x.example", { notionKind: "client", notionPageId: "0123456789abcdef0123456789abcdef", notionUrl: null }],
      ["other@x.example", { notionKind: "none", notionPageId: null, notionUrl: null }],
    ]);
  });

  it("rejects an unknown action", async () => {
    await expect(repos.inbox.record({ ...base, action: "x" as never })).rejects.toThrow(/Unknown action/);
  });
});

describe("recorded evidence (P28 C1-C3)", () => {
  const base = { project: "p", email: "ev@x.example", name: "Ev", subject: "Re: terms", mailRef: "<ev@x>" };
  const weak = { level: "weak" as const, source: "claimed" as const, findings: [{ code: "anchor-duplicate", text: "an anchor equals one of a@x.example's", amber: false }, { code: "profile-stale", text: "old profile", amber: true }], context: { profile: { read: true, state: "empty" }, thread: { found: 3, read: 2 } }, similarTo: "a@x.example", fingerprint: [1, 2, 3], batchKey: "b1" };

  it("stores the evidence block and a sketch, never a body, and shows it as basedOn", async () => {
    const r = await repos.drafts.record({ ...base, evidence: weak });
    const d = (await repos.drafts.get(r.draftId))!;
    expect(d).toMatchObject({ evidence: "weak", evidenceSource: "claimed", similarTo: "a@x.example", batchKey: "b1", fingerprint: "[1,2,3]", body: "" });
    const [row] = (await repos.clients.review("p", "all"));
    expect(row?.basedOn).toMatchObject({ level: "weak", source: "claimed", similarTo: "a@x.example", context: { profile: { state: "empty" } } });
  });

  it("a draft with no evidence block has no basedOn and no evidence check fires", async () => {
    const r = await repos.drafts.record(base);
    const [row] = (await repos.clients.review("p", "all"));
    expect(row?.basedOn).toBeNull();
    expect(row?.safetyResults.map((x) => x.kind)).toEqual([]);
    expect(r.action).toBe("created");
  });

  it("findings become typed checks: red ones gate Checked, amber ones only show", async () => {
    const r = await repos.drafts.record({ ...base, evidence: weak });
    const [row] = (await repos.clients.review("p", "all"));
    const kinds = Object.fromEntries((row?.safetyResults ?? []).map((x) => [x.kind, x.level]));
    expect(kinds).toMatchObject({ near_duplicate: "red", profile_stale: "amber", profile_empty: "amber", evidence_claimed: "amber" });
    expect(row?.blocked).toBe(true);
    await expect(repos.drafts.setChecked(r.draftId, true)).rejects.toThrow();
    await repos.drafts.acknowledge(r.draftId, "near_duplicate", true);
    expect((await repos.drafts.get(r.draftId))?.acked).toContain("near_duplicate");
    expect((await repos.drafts.setChecked(r.draftId, true))?.checked).toBe(true);
  });

  it("the thin-basis filter lists open drafts whose evidence is weak or missing, and counts them", async () => {
    await repos.drafts.record({ ...base, evidence: weak });
    await repos.drafts.record({ ...base, email: "ok@x.example", mailRef: "<ok@x>", evidence: { level: "ok", source: "observed", findings: [] } });
    expect((await repos.clients.review("p", "thin_basis")).map((x) => x.client.email)).toEqual(["ev@x.example"]);
    expect((await repos.clients.counts("p")).thin_basis).toBe(1);
  });

  it("mail_versions (P65): a version written before draft record is linked to the draft it records; byMailRef finds the draft in any form", async () => {
    const v = await repos.mailVersions.add({ project: "p", mailRef: "<T1@X>", account: "desk", mailId: 5, messageId: "<New@x>", hash: "h", source: "agent" });
    expect((await repos.mailVersions.ofThread("p", "t1@x"))[0]).toMatchObject({ id: v, draftId: null, mailRef: "t1@x", messageId: "New@x" });
    const r = await repos.drafts.record({ project: "p", email: "v@x.example", name: "V", subject: "Re", mailRef: "t1@x" });
    expect((await repos.mailVersions.ofDraft(r.draftId)).map((x) => x.id)).toEqual([v]);
    expect((await repos.drafts.byMailRef("p", "<T1@x>")).map((d) => d.id)).toEqual([r.draftId]);
    expect(await repos.drafts.byMailRef("other", "t1@x")).toEqual([]);
    await repos.mailVersions.markTrashed([v]);
    expect((await repos.mailVersions.ofDraft(r.draftId))[0]?.trashedAt).not.toBeNull();
  });

  it("mail_versions.add keeps one row per recorded Mail draft (P65 S5: the card may adopt a save its writer still waits for)", async () => {
    const a = await repos.mailVersions.add({ project: "p", mailRef: "t2@x", account: "desk", mailId: 5, messageId: "<Same@x>", hash: "h", source: "adopted" });
    expect(await repos.mailVersions.add({ project: "p", mailRef: "t2@x", account: "desk", mailId: 5, messageId: "Same@x", hash: "h", source: "agent" })).toBe(a);
    expect(await repos.mailVersions.add({ project: "p", mailRef: "t2@x", account: "other", mailId: 6, messageId: "Same@x", hash: "h", source: "agent" })).not.toBe(a);
  });

  it("mail_writes (P65 S5): a write is recorded before the save with the hash of its text, settled once, and found by thread or draft", async () => {
    const r = await repos.drafts.record({ project: "p", email: "w@x.example", name: "W", subject: "Re", mailRef: "w1@x" });
    const id = await repos.mailWrites.start({ project: "p", mailRef: "<W1@x>", draftId: r.draftId, text: "Привет,\nмой друг!" });
    await repos.mailWrites.shell(id, "On Mon, Ann wrote:\nq");
    const [w] = await repos.mailWrites.ofThread("p", "w1@x", r.draftId);
    expect(w).toMatchObject({ id, mailRef: "w1@x", draftId: r.draftId, settledAt: null, textLen: "Привет, мой друг!".length, shellHash: shellHashOf("On Mon, Ann wrote: q") });
    expect(JSON.stringify(w)).not.toMatch(/Привет/);
    await repos.mailWrites.settle(id, { mailId: 9, messageId: "<N@x>" });
    await repos.mailWrites.settle(id, { mailId: 10, messageId: "other@x" });
    expect((await repos.mailWrites.ofThread("p", "w1@x"))[0]).toMatchObject({ mailId: 9, messageId: "N@x" });
    expect(await repos.mailWrites.ofThread("q", "w1@x")).toEqual([]);
  });

  it("adoptable (P65 S5, live texts of 2026-11-19): a late save, a second save of a recorded text and the write's shell are the Hub's; anything else stays the owner's", () => {
    const written = "Привет, мой друг!\nПисьмо прочёл я,";
    const k = textKey(written);
    // Mail adds a leading line break, turns U+2028 into a line break, and appends the quote.
    const late = { ref: "139858", account: "hello@x", messageId: "0DD9@x", body: "\nПривет, мой друг!\u2028Письмо прочёл я,\n\nOn 14 Nov, Mark wrote:\n> q" };
    const dup = { ref: "139859", account: "hello@x", messageId: "DUP@x", body: "Recorded text\n" };
    const shell = { ref: "139835", account: "hello@x", messageId: "SH@x", body: "\n\nOn 14 Nov, Mark wrote:\nq\n" };
    const owner = { ref: "139900", account: "hello@x", messageId: "OWN@x", body: "Привет, мой друг! My own words" };
    const recorded = { ref: "139868", account: "hello@x", messageId: "A76C@x", body: "anything" };
    expect(startsWithWrite(late.body, { textHash: k.hash, textLen: k.len })).toBe(true);
    // A prefix that ends mid-word is not a match.
    const part = textKey("Привет, мой друг");
    expect(startsWithWrite("Привет, мой другой", { textHash: part.hash, textLen: part.len })).toBe(false);
    const versions = [{ account: "hello@x", messageId: "A76C@x", hash: versionHashOf("Recorded text") }];
    const writes = [{ id: 3, textHash: k.hash, textLen: k.len, shellHash: shellHashOf("On 14 Nov, Mark wrote: q"), settledAt: null }];
    const got = adoptable([late, dup, shell, owner, recorded], versions, writes).map((a) => [a.draft.ref, a.why, a.writeId]);
    expect(got).toEqual([["139858", "late_save", 3], ["139859", "same_text", null], ["139835", "shell", 3]]);
    // Mail's empty reply, known from the answered message's text (live 139835 against 138994), with no write row at all.
    const original = "How are you? Its new request\n\n-- \nRegards!\n\n\n";
    const mailShell = { ref: "139835", account: "hello@x", messageId: "SH2@x", body: "\n\nOn 14 Nov 2026, at 14:26, Mark Effect <markolofsen@gmail.com> wrote:\nHow are you? Its new request\n\n-- \nRegards!\n\n\n\n" };
    expect(isReplyShell(mailShell.body, original)).toBe(true);
    expect(isReplyShell(`Thanks, I will call.\n${mailShell.body}`, original)).toBe(false);
    expect(isReplyShell(`${mailShell.body}\nPS mine`, original)).toBe(false);
    expect(isReplyShell(mailShell.body, null)).toBe(false);
    expect(adoptable([mailShell, owner], [], [], original).map((a) => [a.draft.ref, a.why])).toEqual([["139835", "mail_shell"]]);
    // A settled write no longer adopts anything by its text or its shell.
    expect(adoptable([late, shell], [], [{ ...writes[0]!, settledAt: "2026-11-19T12:50:40Z" }])).toEqual([]);
    // P83: the empty draft Mail kept from a refused write (saas 140019) is that open write's; with no open write it stays.
    const empty = { ref: "140019", account: "hello@x", messageId: "5339@x", body: "\n\n" };
    expect(adoptable([empty, owner], [], writes).map((a) => [a.draft.ref, a.why, a.writeId])).toEqual([["140019", "empty_shell", 3]]);
    expect(adoptable([empty], [], [])).toEqual([]);
    expect(adoptable([empty], [], [{ ...writes[0]!, settledAt: "2026-11-19T12:50:40Z" }])).toEqual([]);
  });

  it("signature_language (P65 S2): amber when the newest version the Hub wrote was signed in English for another language", async () => {
    const r = await repos.drafts.record({ project: "p", email: "s@x.example", name: "S", subject: "Re", mailRef: "s1@x" });
    const of = async () => (await repos.sends.safetyOf(r.draftId, { subject: "Re", toAddr: "s@x.example", ccAddr: null, body: "Здравствуйте" })).find((x) => x.kind === "signature_language");
    expect(await of()).toBeUndefined();
    await repos.mailVersions.add({ project: "p", mailRef: "s1@x", draftId: r.draftId, account: "desk", mailId: 1, messageId: "a@x", hash: "h", source: "agent", signatureFallback: "ru" });
    expect(await of()).toMatchObject({ level: "amber" });
  });
});
