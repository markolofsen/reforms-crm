import { describe, expect, it } from "vitest";
import { ACTIVITY_VIEWS as TIMELINE_VIEWS } from "@hub/contract/activity";
import { ACTIVITY_VIEWS, LOG_SEARCH, readSearch } from "../src/routes/search";
import { VIEW_LABELS, VIEW_ORDER } from "../src/features/log/labels";

describe("activity labels (P73)", () => {
  it("every view has a word and a place in the View menu, by outcome, then Sends", () => {
    expect(Object.keys(VIEW_LABELS).sort()).toEqual([...ACTIVITY_VIEWS].sort());
    expect([...VIEW_ORDER].sort()).toEqual([...ACTIVITY_VIEWS].sort());
    expect(VIEW_ORDER).toEqual([...TIMELINE_VIEWS, "follow-ups", "sends", "errors"]);
    expect(VIEW_LABELS).toMatchObject({ all: "All", needs_you: "Needs you", drafts: "Drafts", skipped: "Skipped", "follow-ups": "Follow-ups", sends: "Sends", errors: "Errors" });
  });

  it("the address holds the view and the one client; the run views and `?run=` are gone", () => {
    expect(readSearch(LOG_SEARCH, { kind: "sends" }).kind).toBe("sends");
    expect(readSearch(LOG_SEARCH, { kind: "needs_you", client: "1" })).toEqual({ kind: "needs_you", client: 1 });
    expect(readSearch(LOG_SEARCH, { kind: "failed", run: "3" })).toEqual({ kind: "all", client: null });
    expect(TIMELINE_VIEWS).not.toContain("sends");
  });
});
