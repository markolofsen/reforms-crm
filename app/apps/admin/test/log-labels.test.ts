import { describe, expect, it } from "vitest";
import { RUN_STATUSES } from "@hub/config";
import type { ActivityRowDto, ActivitySessionDto } from "@hub/contract/activity";
import { ACTIVITY_VIEWS, logSearch, RUN_FILTERS } from "../src/routes/search";
import { RUN_FILTER_LABELS, RUN_FILTER_ORDER, VIEW_LABELS, VIEW_ORDER, rowCells, rowSentence, sessionFacts, sessionHeading } from "../src/features/log/labels";

const row = (over: Partial<ActivityRowDto> = {}): ActivityRowDto => ({ id: 1, runId: 1, at: "2026-11-16T15:26:00.000Z", client: null, who: "Mark Effect", outcome: "skipped", why: "already drafted", draftId: null, ...over });
const session = (over: Partial<ActivitySessionDto> = {}): ActivitySessionDto => ({ runId: 1, startedAt: "2026-11-16T15:26:00.000Z", finishedAt: null, skill: "triage-mail", trigger: "owner", status: "ok", model: null, tokens: null, costUsd: null, durationS: null, rows: [], ...over });

describe("activity labels", () => {
  it("every filter has a word and a place in the View menu", () => {
    expect(Object.keys(RUN_FILTER_LABELS).sort()).toEqual([...RUN_FILTERS].sort());
    expect([...RUN_FILTER_ORDER].sort()).toEqual([...RUN_FILTERS].sort());
    expect(RUN_FILTERS).toEqual(["all", ...RUN_STATUSES]);
  });

  it("UX pass: Sends is Activity's last view, read from the address, never a run filter", () => {
    expect([...VIEW_ORDER].sort()).toEqual([...ACTIVITY_VIEWS].sort());
    expect(VIEW_ORDER.at(-1)).toBe("sends");
    expect(VIEW_LABELS.sends).toBe("Sends");
    expect(logSearch({ filter: "sends" }).filter).toBe("sends");
    expect(RUN_FILTERS).not.toContain("sends");
  });

  it("a heading counts the decisions, not the notes, and says a session that did not finish", () => {
    const s = session({ rows: [row(), row({ id: 2, outcome: "escalated" }), row({ id: 3, outcome: "other", who: "Updated 3 profiles" })], status: "failed" });
    expect(sessionHeading(s)).toMatch(/ · triage-mail · 2 decisions · Did not finish$/);
    expect(sessionHeading(session())).toMatch(/ · triage-mail · 0 decisions$/);
  });

  it("a decision names the client and gives the reason; a note is the agent's own words", () => {
    expect(rowCells(row({ client: { id: 4, name: "Mark E." } }))).toEqual({ who: "Mark E.", what: "Skipped", why: "already drafted" });
    expect(rowSentence(row())).toBe("Mark Effect: skipped. Already drafted.");
    expect(rowSentence(row({ why: null, outcome: "escalated" }))).toBe("Mark Effect: escalated.");
    expect(rowCells(row({ outcome: "other", who: "Updated 3 client profiles in Notion", why: null }))).toEqual({ who: "", what: "Note", why: "Updated 3 client profiles in Notion" });
  });

  it("an unknown or zero number is left out, never 0s or $0.00", () => {
    expect(sessionFacts(session())).toEqual([]);
    expect(sessionFacts(session({ model: "sonnet", tokens: { in: 0, out: 0 }, costUsd: 0, durationS: 0 }))).toEqual(["sonnet"]);
    expect(sessionFacts(session({ costUsd: 0.001, durationS: 120 }))).toEqual(["2m"]);
    expect(sessionFacts(session({ model: "m1", tokens: { in: 48_200, out: 900 }, costUsd: 0.31, durationS: 95 }))).toEqual(["m1", "48.2k in, 900 out", "$0.31", "1m 35s"]);
  });
});
