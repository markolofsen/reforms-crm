import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leadPassDisplay } from "@hub/config/lead-pass";
import { openDb, type DbHandle } from "../src/client";
import { createRepos, type Repos } from "../src/repos";
import { dueLeads } from "../src/repos/lead-pass";
import type { NewLead } from "../src/repos/lead-rows";

// P147 L1 (decision 0055, migration 0047): the daily lead pass's list, its decisions, Redo, the untick, the day's lead batch
// and the derived display states.
let h: DbHandle;
let repos: Repos;
beforeEach(() => {
  // The fixture's day and the draft writer's clock must agree after 2026-11-25 too.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T09:30:00.000Z"));
  h = openDb(":memory:");
  repos = createRepos(h.db);
});
afterEach(() => { h.close(); vi.useRealTimers(); });

const NOW = new Date("2026-11-25T09:30:00.000Z");
const FROM = "2026-11-11T09:30:00.000Z";
const A = "a".repeat(32);
const B = "b".repeat(32);
const lead = (pageId: string, o: Partial<NewLead> = {}): NewLead => ({ project: "p", pageId, name: "KodaCar", email: "kobo@x.test", accountEmail: null, brand: "Carapis", receivedAt: "2026-11-24T10:00:00.000Z", preview: "We need the API", notionStatus: "New", hasClient: false, ...o });
const record = (o: { email?: string; pageId?: string; passId?: number | null; day?: string } = {}) =>
  repos.drafts.record({ project: "p", email: o.email ?? "kobo@x.test", name: "KodaCar", subject: "Your Carapis API request", mailRef: null, newThread: true, ownerRequest: `daily lead pass 2026-11-25, Notion lead ${o.pageId ?? A}`, leadPass: { pageId: o.pageId ?? A, passId: o.passId ?? null, day: o.day ?? "2026-11-25" } });

describe("leadPass.due (verdict 3)", () => {
  it("lists open leads in the window with no decision, newest first, and cuts at the limit with the total", async () => {
    await repos.leadRows.sync(
      [
        lead(A),
        lead(B, { email: "b@x.test", receivedAt: "2026-11-23T10:00:00.000Z" }),
        lead("c".repeat(32), { email: "old@x.test", receivedAt: "2026-10-01T10:00:00.000Z" }),
        lead("d".repeat(32), { email: "closed@x.test", notionStatus: "In progress" }),
      ],
      NOW,
    );
    await repos.leadRows.dismiss("p", "d".repeat(32), "not_now", NOW);
    const due = await repos.leadPass.due("p", FROM, 1);
    expect(due.rows.map((r) => r.pageId)).toEqual([A]);
    expect(due.total).toBe(2);
  });

  it("a decided lead is not listed again; a decision changes until the owner applied it (F2); Redo lists it again", async () => {
    await repos.leadRows.sync([lead(A)], NOW);
    const pass = await repos.leadPass.startPass("p", "dock", NOW.toISOString());
    await repos.leadPass.finishPass(pass.id, { handedOver: 1 });
    expect((await repos.leadPass.decide({ project: "p", pageId: A, decision: "hand_over", reason: "Enterprise volume", passId: pass.id, at: NOW.toISOString() })).already).toBe(false);
    expect((await repos.leadPass.due("p", FROM)).total).toBe(0);
    const changed = await repos.leadPass.decide({ project: "p", pageId: A, decision: "spam", reason: "a link shortener", passId: pass.id, at: NOW.toISOString() });
    expect(changed).toMatchObject({ already: false, changed: "hand_over", row: { passDecision: "spam" } });
    expect((await repos.leadPass.pass("p", pass.id))?.handedOver).toBe(0);
    await repos.leadRows.dismiss("p", A, "spam", NOW);
    const again = await repos.leadPass.decide({ project: "p", pageId: A, decision: "reply", reason: "x", passId: null, at: NOW.toISOString() });
    expect(again).toMatchObject({ already: true, row: { passDecision: "spam" } });
    await repos.leadRows.undismiss("p", A);
    expect(await repos.leadPass.redo("p", A)).toBe(true);
    expect((await repos.leadPass.due("p", FROM)).rows.map((r) => r.pageId)).toEqual([A]);
  });

  it("the pure selector holds each clause", () => {
    const rows = [
      { id: 1, receivedAt: "2026-11-24", passDecision: null, open: true },
      { id: 2, receivedAt: "2026-11-25", passDecision: null, open: true },
      { id: 3, receivedAt: "2026-11-25", passDecision: "reply" as const, open: true },
      { id: 4, receivedAt: "2026-11-25", passDecision: null, open: false },
      { id: 5, receivedAt: "2026-10-01", passDecision: null, open: true },
    ];
    expect(dueLeads(rows, "2026-11-11").map((r) => r.id)).toEqual([2, 1]);
  });
});

describe("the pass draft (verdicts 2 and 6)", () => {
  it("joins the day's one lead batch and stamps its lead; the decision is written after the draft closed the lead", async () => {
    await repos.leadRows.sync([lead(A), lead(B, { email: "b@x.test" })], NOW);
    const pass = await repos.leadPass.startPass("p", "button", NOW.toISOString());
    const one = await record({ passId: pass.id });
    const two = await record({ email: "b@x.test", pageId: B, passId: pass.id });
    const d1 = await repos.drafts.get(one.draftId);
    const d2 = await repos.drafts.get(two.draftId);
    expect(d1?.batchId).not.toBeNull();
    expect(d2?.batchId).toBe(d1?.batchId);
    const batch = await repos.batches.get("p", d1?.batchId as number);
    expect(batch).toMatchObject({ intent: "lead_reply", name: "Leads 25 Nov 2026", brief: "Daily lead pass", total: 2 });
    // The draft closed the lead (OPEN_LEAD), and the turn's decision still lands.
    expect((await repos.leadRows.get("p", A))?.open).toBe(false);
    expect((await repos.leadPass.item("p", A))?.display).toBe("new");
    await repos.leadPass.decide({ project: "p", pageId: A, decision: "reply", reason: "asks for VIN decode", passId: pass.id, at: NOW.toISOString() });
    expect(await repos.leadPass.item("p", A)).toMatchObject({ display: "drafted", passDraftId: one.draftId, passId: pass.id });
    expect((await repos.leadPass.ofBatch("p", d1?.batchId as number)).map((r) => r.pageId).sort()).toEqual([A, B]);
    expect(await repos.leadPass.dayBatch("p", "2026-11-25")).toBe(d1?.batchId);
    // The next day is a new batch.
    const three = await record({ email: "c@x.test", pageId: "c".repeat(32), day: "2026-11-26" });
    expect((await repos.drafts.get(three.draftId))?.batchId).not.toBe(d1?.batchId);
  });

  it("the untick shows Excluded and a skipped draft shows Draft gone; the views put them in Drafted", async () => {
    await repos.leadRows.sync([lead(A), lead(B, { email: "b@x.test" })], NOW);
    const one = await record();
    await repos.leadPass.decide({ project: "p", pageId: A, decision: "reply", reason: "a prospect", passId: null, at: NOW.toISOString() });
    await repos.leadPass.decide({ project: "p", pageId: B, decision: "spam", reason: "a link shortener as the site", passId: null, at: NOW.toISOString() });
    expect((await repos.leadPass.item("p", B))?.display).toBe("proposed");
    const v = await repos.leadRows.views("p", "drafted", FROM);
    expect(v.counts).toMatchObject({ new: 0, drafted: 2, for_you: 0 });
    expect(await repos.leadPass.exclude("p", [A], NOW.toISOString())).toBe(1);
    expect((await repos.leadPass.item("p", A))?.display).toBe("excluded");
    await repos.leadPass.redo("p", A);
    await repos.leadPass.decide({ project: "p", pageId: A, decision: "client", reason: "existing client", passId: null, at: NOW.toISOString() });
    expect((await repos.leadPass.item("p", A))?.display).toBe("draft_gone");
    expect(one.draftId).toBeGreaterThan(0);
  });

  it("D5: a lead not converted and not spam is found by its address; a converted one is not", async () => {
    await repos.leadRows.sync([lead(A)], NOW);
    expect((await repos.leadPass.unconvertedLead("p", "KOBO@x.test"))?.pageId).toBe(A);
    await repos.leadRows.markConverted("p", [A], { clientPageId: "c1", note: null }, NOW);
    expect(await repos.leadPass.unconvertedLead("p", "kobo@x.test")).toBeNull();
  });

  it("the passes ledger counts turns across projects since a moment", async () => {
    const a = await repos.leadPass.startPass("p", "schedule", NOW.toISOString());
    await repos.leadPass.finishPass(a.id, { turns: 4, replied: 3, handedOver: 1, finishedAt: NOW.toISOString() });
    const b = await repos.leadPass.startPass("q", "button", NOW.toISOString());
    await repos.leadPass.finishPass(b.id, { turns: 2 });
    expect(await repos.leadPass.passTurnsSince("2026-11-25T00:00:00.000Z")).toBe(6);
    expect((await repos.leadPass.lastPass("p"))?.id).toBe(a.id);
  });
});

describe("leadPassDisplay (verdict 2)", () => {
  const base = { passDecision: null, passDraftId: null, passExcludedAt: null, convertedAt: null, dismissedReason: null, notionStatus: "New", draftStatus: null } as const;
  it("the owner's marks come first, then the decision", () => {
    expect(leadPassDisplay(base)).toBe("new");
    expect(leadPassDisplay({ ...base, convertedAt: "x", passDecision: "reply" })).toBe("sent");
    expect(leadPassDisplay({ ...base, dismissedReason: "spam", passDecision: "spam" })).toBe("spam");
    expect(leadPassDisplay({ ...base, passDecision: "hand_over" })).toBe("for_you");
    expect(leadPassDisplay({ ...base, passDecision: "not_now" })).toBe("proposed");
    expect(leadPassDisplay({ ...base, passDecision: "reply", passDraftId: 3, draftStatus: "ready" })).toBe("drafted");
    expect(leadPassDisplay({ ...base, passDecision: "reply", passDraftId: 3, draftStatus: "skipped" })).toBe("draft_gone");
  });
});
