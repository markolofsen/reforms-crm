import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DraftActionRow, DraftSendButton } from "../src/product/conversation/draft-action-row";
import { orderItems, reviewGate, type ReviewItem } from "../src/product/conversation/review-dialog";

// P105 S1: the review dialog's two pure rules (the reading order and when the one confirm may run), and the shared action row.
const warn = (key: string): ReviewItem => ({ key, severity: "warning", text: key });
const block = (key: string): ReviewItem => ({ key, severity: "blocker", text: key });

describe("ReviewDialog order", () => {
  it("lists blockers first and keeps the caller's order inside each group", () => {
    expect(orderItems([warn("w1"), block("b1"), warn("w2"), block("b2")]).map((i) => i.key)).toEqual(["b1", "b2", "w1", "w2"]);
    expect(orderItems([])).toEqual([]);
  });
});

describe("ReviewDialog gate", () => {
  it("warnings never block: reading them and pressing is the consent", () => {
    expect(reviewGate([warn("a"), warn("b")])).toEqual({ blockers: 0, warnings: 2, canConfirm: true, reason: null });
    expect(reviewGate([])).toMatchObject({ canConfirm: true, reason: null });
  });

  it("one blocker keeps the confirm off and says why, in the singular and the plural", () => {
    expect(reviewGate([warn("a"), block("b")])).toEqual({ blockers: 1, warnings: 1, canConfirm: false, reason: "Fix the problem above first." });
    expect(reviewGate([block("a"), block("b")]).reason).toBe("Fix the 2 problems above first.");
  });

  it("waits while the items are still read, and while the confirm itself runs", () => {
    expect(reviewGate([], { loading: true })).toMatchObject({ canConfirm: false, reason: "Still reading what goes out." });
    expect(reviewGate([warn("a")], { pending: true })).toMatchObject({ canConfirm: false, reason: null });
    // A blocker is named before the read: the owner sees the fix while Mail is still read.
    expect(reviewGate([block("a")], { loading: true }).reason).toBe("Fix the problem above first.");
  });
});

describe("DraftActionRow", () => {
  it("is one labelled group: the start actions, then the one primary at the end", () => {
    const html = renderToStaticMarkup(<DraftActionRow primary={<DraftSendButton onClick={() => {}} who="Anna" />} start={<span>Skip</span>} />);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Actions"');
    expect(html.indexOf("Skip")).toBeLessThan(html.indexOf("draft-send"));
    expect(html.match(/data-variant="primary"/g)).toHaveLength(1);
    expect(html).toContain("the reply to Anna");
  });
});
