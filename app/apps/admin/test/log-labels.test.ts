import { describe, expect, it } from "vitest";
import { ACTIVITY_VIEWS as TIMELINE_VIEWS } from "@hub/contract/activity";
import { ACTIVITY_VIEWS, logSearch } from "../src/routes/search";
import { VIEW_LABELS, VIEW_ORDER } from "../src/features/log/labels";

describe("activity labels (P73)", () => {
  it("every view has a word and a place in the View menu, by outcome, then Sends", () => {
    expect(Object.keys(VIEW_LABELS).sort()).toEqual([...ACTIVITY_VIEWS].sort());
    expect([...VIEW_ORDER].sort()).toEqual([...ACTIVITY_VIEWS].sort());
    expect(VIEW_ORDER).toEqual([...TIMELINE_VIEWS, "sends"]);
    expect(VIEW_LABELS).toMatchObject({ all: "All", needs_you: "Needs you", drafts: "Drafts", skipped: "Skipped", sends: "Sends" });
  });

  it("the address holds the view and the one client; the run views and `?run=` are gone", () => {
    expect(logSearch({ filter: "sends" }).filter).toBe("sends");
    expect(logSearch({ filter: "needs_you", client: "1" })).toEqual({ filter: "needs_you", client: 1 });
    expect(logSearch({ filter: "failed", run: "3" })).toEqual({ filter: "all", client: null });
    expect(TIMELINE_VIEWS).not.toContain("sends");
  });
});
