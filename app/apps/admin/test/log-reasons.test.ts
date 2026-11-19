import { describe, expect, it } from "vitest";
import { humanise, readReason, REASON_LABELS } from "../src/features/log/labels";

describe("activity reasons", () => {
  it("a known code reads as a short phrase; the agent's words stay as the detail and the code stays in the data", () => {
    expect(readReason("already-drafted: unmarked draft 138996 in Drafts replies to the same newest inbound (In-Reply-To matches)")).toEqual({
      code: "already-drafted",
      phrase: "Already has a draft",
      detail: "unmarked draft 138996 in Drafts replies to the same newest inbound (In-Reply-To matches)",
    });
    expect(readReason("not-allowed-recipient: draft.recipients=test admits only the allow_list; quote/proposal enquiry for Carapis left undrafted")).toEqual({
      code: "not-allowed-recipient",
      phrase: "Not an allowed recipient",
      detail: "draft.recipients=test admits only the allow_list; quote/proposal enquiry for Carapis left undrafted",
    });
    expect(readReason("already-drafted")).toEqual({ code: "already-drafted", phrase: "Already has a draft", detail: null });
  });

  it("the skill's `skipped:` prefix, underscores and a comma after a known code are read too", () => {
    expect(readReason("skipped:already-drafted")).toEqual({ code: "already-drafted", phrase: "Already has a draft", detail: null });
    expect(readReason("already_drafted")).toMatchObject({ phrase: "Already has a draft" });
    expect(readReason("opted_out")).toEqual({ code: "opted_out", phrase: "Opted out", detail: null });
    expect(readReason("scheduling, see calendar")).toEqual({ code: "scheduling", phrase: "Wants a meeting", detail: "see calendar" });
  });

  it("error:<tool> names the tool", () => {
    expect(readReason("error:mail-mcp: timed out after 30 s")).toEqual({ code: "error", phrase: "Error in mail-mcp", detail: "timed out after 30 s" });
    expect(readReason("error:notion")).toEqual({ code: "error", phrase: "Error in notion", detail: null });
  });

  it("an unknown code falls back to its words", () => {
    expect(readReason("some-new-code: the agent's words")).toEqual({ code: "some-new-code", phrase: "Some new code", detail: "the agent's words" });
    expect(readReason("thin_basis")).toEqual({ code: "thin_basis", phrase: "Thin basis", detail: null });
    expect(humanise("out_of-office")).toBe("Out of office");
  });

  it("a sentence is the agent's own words, shown as written", () => {
    for (const why of ["draft.recipients=test: external address not in allow_list; CarAPIS lead", "already drafted", "A mailing list, no reply needed.", "newsletter", "newsletter, no reply"]) {
      expect(readReason(why)).toEqual({ code: null, phrase: why, detail: null });
    }
  });

  it("every phrase is short, capitalised and has no trailing stop", () => {
    for (const [code, phrase] of Object.entries(REASON_LABELS)) {
      expect(code).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(phrase).toMatch(/^[A-Z][^.]{2,30}$/);
    }
  });
});
