import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { sendLatch } from "../src/features/review/card/use-send-flow";
import { REVIEW_DWELL_MS } from "@hub/ui/product/review-dialog";
import { UNDO_WINDOW_MS, undoTarget, type ReviewDraft } from "../src/features/review/source";
import { refreshData } from "../src/lib/api/client";

const draft = (id: number, canUndo = false) => ({ id, canUndo }) as unknown as ReviewDraft;

describe("undo target after keyboard actions", () => {
  it("D then U undoes the draft that was marked done, not the next one the card moved to", () => {
    const done = draft(1);
    const next = draft(2, false);
    expect(undoTarget({ draft: done, at: 1_000 }, next, 2_000)?.id).toBe(1);
  });
  it("beats an open draft that could also be undone: the last action wins", () => {
    expect(undoTarget({ draft: draft(1), at: 0 }, draft(2, true), 1)?.id).toBe(1);
  });
  it("falls back to the open draft when nothing was changed recently, and to nothing when it cannot be undone", () => {
    expect(undoTarget(null, draft(2, true), 0)?.id).toBe(2);
    expect(undoTarget(null, draft(2, false), 0)).toBeNull();
    expect(undoTarget({ draft: draft(1), at: 0 }, draft(2, true), UNDO_WINDOW_MS + 1)?.id).toBe(2);
    expect(undoTarget(null, null, 0)).toBeNull();
  });
});

describe("a send is announced and advanced once", () => {
  it("fires on the first render that reads sent, not on the re-renders after the refetch", () => {
    const latch = sendLatch();
    expect([latch(false), latch(true), latch(true), latch(true)]).toEqual([false, true, false, false]);
  });
  it("arms again once the flow has left sent", () => {
    const latch = sendLatch();
    latch(true);
    latch(false);
    expect(latch(true)).toBe(true);
  });
});

describe("the review dialog's dwell (P105: a held Shift+Enter must not press the Send it opened)", () => {
  it("is a named constant of about 400 ms, in the dialog", () => {
    expect(REVIEW_DWELL_MS).toBe(400);
  });
});

describe("refreshData re-reads Mail only when asked", () => {
  const seed = () => {
    const qc = new QueryClient();
    for (const key of ["drafts", "draft-mail", "thread", "timeline", "pulse"]) qc.setQueryData([key, "p"], 1);
    return qc;
  };
  const stale = (qc: QueryClient) => ["drafts", "draft-mail", "thread", "timeline", "pulse"].filter((k) => qc.getQueryState([k, "p"])?.isInvalidated);
  it("a tone, switch or mark change leaves the Mail reads alone", async () => {
    const qc = seed();
    await refreshData(qc);
    expect(stale(qc)).toEqual(["drafts", "timeline"]);
  });
  it("a status change or a send reads Mail again", async () => {
    const qc = seed();
    await refreshData(qc, { mail: true });
    expect(stale(qc)).toEqual(["drafts", "draft-mail", "thread", "timeline"]);
  });
});
