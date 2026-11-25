import { describe, expect, it } from "vitest";
import type { LeadReviewDto } from "@hub/contract/lead-pass";
import { groupRows, initialTicks, proposalsLine, readyRows, ticketOf } from "../src/features/mail/leads/review";
import { allIds } from "../src/features/mail/list/use-selection";
import { selectedReady } from "../src/features/mail/ready/send-ready";
import type { ConversationRow } from "../src/features/mail/model";

// P147 3m items 4 and 5: select all ticks every row the list shows; Send all ready counts only the replies that would go now, opens
// them ticked, leaves out of today only what the owner unticked, and a selection's Send N touches only its own drafts.

type Row = LeadReviewDto["rows"][number];
const row = (draftId: number, o: Partial<Row> = {}): Row =>
  ({ kind: "lead", newSender: false, pageId: `p${draftId}`, name: `Person ${draftId}`, email: `p${draftId}@x.test`, brand: null, receivedAt: "2026-11-25T08:00:00Z", request: "a question", decision: "reply", reason: null, display: "drafted", draftId, ticked: true, held: [], mail: { to: [`p${draftId}@x.test`], subject: "Re: question", body: "Hello,\n\nThe answer." }, ...o }) as Row;
const review = (rows: Row[], proposals: LeadReviewDto["proposals"] = []): LeadReviewDto => ({ batchId: 7, rows, proposals, handOvers: [], spacingSeconds: 20, cap: { used: 0, limit: 50 } }) as unknown as LeadReviewDto;
const proposal = (n: number, decision: "spam" | "not_now" | "no_reply", kind: "lead" | "mail" = "lead") => ({ kind, pageId: kind === "mail" ? String(n) : `q${n}`, inbound: kind === "mail" ? n : null, name: `P${n}`, email: null, site: null, request: "", decision, reason: null });

describe("select all (3m item 4)", () => {
  it("picks every row the list shows, with or without an open draft", () => {
    const rows = [{ client: { id: 1 }, draft: null }, { client: { id: 2 }, draft: { id: 9, status: "sent" } }, { client: { id: 3 }, draft: { id: 10, status: "ready" } }] as unknown as ConversationRow[];
    expect([...allIds(rows)]).toEqual([1, 2, 3]);
  });
});

describe("Send all ready (3m item 5)", () => {
  const d = review([row(1), row(2, { mail: { to: ["a@x.test"], subject: "s", body: "Price: [Owner: the price]" } }), row(3, { kind: "mail", newSender: true, ticked: false }), row(4, { held: ["outside the send window"], ticked: false }), row(5, { kind: "mail" })], [proposal(1, "spam"), proposal(2, "no_reply", "mail")]);

  it("counts only the replies that go now: no placeholder, nothing held, not a new sender", () => {
    expect(readyRows(d).map((r) => r.draftId)).toEqual([1, 5]);
    expect([...initialTicks(d)]).toEqual([1, 5]);
  });

  it("groups needs-your-input on top, leads then mail, new senders apart", () => {
    const g = groupRows(d.rows);
    expect(g.needs.map((r) => r.draftId)).toEqual([2]);
    expect(g.ready.map((r) => r.draftId)).toEqual([1, 4, 5]);
    expect(g.newSenders.map((r) => r.draftId)).toEqual([3]);
  });

  it("sends the ticked, excludes only what the owner unticked, and posts the proposals by page or inbound row", () => {
    expect(ticketOf(d, initialTicks(d), initialTicks(d), true, null)).toEqual({ send: [1, 5], exclude: [], proposals: [{ pageId: "q1", decision: "spam" }, { inbound: 2, decision: "no_reply" }] });
    expect(ticketOf(d, new Set([5, 3]), initialTicks(d), false, null)).toEqual({ send: [3, 5], exclude: [1], proposals: [] });
  });

  it("never excludes a row that became ready after the list opened (the owner never unticked it)", () => {
    const before = review([row(1), row(6, { held: ["Mail is busy"], ticked: false })]);
    const opened = initialTicks(before);
    const after = review([row(1), row(6)]);
    expect(ticketOf(after, opened, opened, false, null)).toEqual({ send: [1], exclude: [], proposals: [] });
  });

  it("a selection's Send N limits the click to its drafts and never marks proposals", () => {
    expect(ticketOf(d, initialTicks(d), initialTicks(d), true, new Set([5]))).toEqual({ send: [5], exclude: [], proposals: [] });
    const ctx = { project: "acme", batchId: 7, waiting: { drafts: 5, proposals: 2 }, open: () => undefined };
    expect(selectedReady(ctx, [{ id: 5, batchId: 7 }, { id: 3, batchId: 7 }, { id: 99, batchId: 4 }, { id: 98, batchId: null }])).toEqual([5, 3]);
    expect(selectedReady(null, [{ id: 5, batchId: 7 }])).toEqual([]);
  });

  it("lists a fixed bug's note after the replies and ticks it like any ready reply (P145 B4)", () => {
    const f = review([row(8, { kind: "fixed", pageId: "report-1" }), row(1), row(5, { kind: "mail" })]);
    expect(groupRows(f.rows).ready.map((r) => r.draftId)).toEqual([1, 5, 8]);
    expect([...initialTicks(f)]).toEqual([8, 1, 5]);
  });

    it("says the proposals as one line", () => {
    expect(proposalsLine(d.proposals)).toBe("Also mark 2 as spam / no reply needed");
    expect(proposalsLine([proposal(1, "spam"), proposal(2, "not_now"), proposal(3, "spam")])).toBe("Also mark 3 as spam / not now");
    expect(proposalsLine([proposal(4, "spam", "mail"), proposal(5, "no_reply", "mail")])).toBe("Also mark 2 as junk / no reply needed");
  });
});
