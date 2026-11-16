import { describe, expect, it } from "vitest";
import { ATTENTION_FOCUS, FRESHNESS as FRESHNESS_STATES, SEVERITIES, VERDICT_LEVELS, type AttentionItem } from "@hub/contract/overview";
import { ago, attentionTarget, countText, FRESHNESS, SEVERITY, VERDICT } from "../src/features/overview/labels";
import { formatDest } from "../src/routes/paths";

const item = (focus: AttentionItem["focus"], over: Partial<AttentionItem> = {}): AttentionItem => ({ kind: "drafts-ready", severity: "needs-owner", project: "alpha", sentence: "alpha: 2 drafts are ready.", focus, ...over });

describe("overview labels", () => {
  it("every severity, freshness state and verdict level has a word and an icon (the maps are total)", () => {
    expect(Object.keys(SEVERITY).sort()).toEqual([...SEVERITIES].sort());
    expect(Object.keys(FRESHNESS).sort()).toEqual([...FRESHNESS_STATES].sort());
    expect(Object.keys(VERDICT).sort()).toEqual([...VERDICT_LEVELS].sort());
  });
  it("off reads as not set up, never as a number", () => {
    expect(FRESHNESS.off.word).toBe("Not set up");
  });
  it("an item leads where the server's focus says, with the item's own project, and the server never wrote a URL", () => {
    expect(ATTENTION_FOCUS).toEqual(["drafts", "project", "overview"]);
    const drafts = attentionTarget(item("drafts", { filter: "hold" }));
    expect(formatDest(drafts.to, drafts.project)).toBe("/drafts?project=alpha&filter=hold");
    const ready = attentionTarget(item("drafts", { filter: "ready" }));
    expect(formatDest(ready.to, ready.project)).toBe("/drafts?project=alpha");
    const project = attentionTarget(item("project"));
    expect(formatDest(project.to, project.project)).toBe("/project?project=alpha");
    const here = attentionTarget(item("overview"));
    expect(formatDest(here.to, here.project)).toBe("/overview?focus=alpha");
    // A system-wide item has no project: its link keeps the open one.
    expect(attentionTarget(item("project", { project: null })).project).toBeNull();
  });
  it("time and counts are words, and a capped count never looks exact", () => {
    const now = new Date("2026-11-15T12:00:00Z").getTime();
    expect([ago("2026-11-15T11:59:40Z", now), ago("2026-11-15T11:48:00Z", now), ago("2026-11-15T09:00:00Z", now), ago("2026-11-12T12:00:00Z", now)]).toEqual(["just now", "12 min ago", "3 h ago", "3 d ago"]);
    expect([countText(212, false), countText(2000, true)]).toEqual(["212", "2,000+"]);
  });
});
