import { describe, expect, it } from "vitest";
import type { ActivityRowDto } from "@hub/contract/activity";
import { dayLabel, daySections, groupCells, groupRows, lineRef, localDay } from "../src/features/log/groups";

// P73: the timeline's day headings and its bounded fold. Local times (the machine's zone), and every time is at least an hour
// from midnight, so the day of each row is the same in any zone the tests run in.
const at = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).toISOString();
let next = 1;
const row = (over: Partial<ActivityRowDto> = {}): ActivityRowDto => ({ ...((id) => ({ id, key: `event:${id}` }))(next++), at: at(19, 20, 50), client: { id: 7, name: "Mark Effect" }, who: "Mark Effect", outcome: "updated", why: null, draftId: 1, skill: null, provider: null, ...over });
const NOW = new Date(2026, 10, 20, 14, 0).getTime();

describe("the timeline's fold", () => {
  it("consecutive entries of one client with one outcome on one day fold into one line; a single entry stays one line", () => {
    const rows = [row(), row(), row(), row({ outcome: "skipped" }), row({ client: { id: 8, name: "Ann" }, who: "Ann" }), row()];
    expect(groupRows(rows).map((g) => g.rows.length)).toEqual([3, 1, 1, 1]);
    expect(groupRows([row()]).map((g) => g.rows.length)).toEqual([1]);
    expect(groupRows([])).toEqual([]);
  });

  it("the fold stops at a day change: a save on 19 Nov and one on 18 Nov are two lines", () => {
    const rows = [row({ at: at(19, 11, 5) }), row({ at: at(18, 21, 48) }), row({ at: at(18, 21, 36) })];
    expect(groupRows(rows).map((g) => g.rows.length)).toEqual([1, 2]);
  });

  it("a sender with no client row folds by its recorded name", () => {
    const anon = { client: null, who: "Talha (Car4Guru)", outcome: "skipped" as const, draftId: null };
    expect(groupRows([row(anon), row(anon), row({ ...anon, who: "Other" })]).map((g) => g.rows.length)).toEqual([2, 1]);
  });

  it("a folded line says the count and the range from the oldest entry to the newest; reason, draft and skill only when shared", () => {
    const [g] = groupRows([row({ at: at(19, 20, 50), draftId: 3 }), row({ at: at(19, 14, 26), draftId: 4 }), row({ at: at(19, 11, 5), draftId: 5 })]);
    if (!g) throw new Error("no group");
    expect(groupCells(g)).toEqual({ who: "Mark Effect", what: "Updated the draft", count: 3, when: "11:05 – 20:50", why: "", detail: null, draftId: null, skill: null });
    const why = "already-drafted: draft 9 in Drafts";
    const [s] = groupRows([row({ outcome: "skipped", why, draftId: 9, skill: "triage-mail" }), row({ outcome: "skipped", why, draftId: 9, skill: "triage-mail" })]);
    if (!s) throw new Error("no group");
    expect(groupCells(s)).toMatchObject({ what: "Skipped", count: 2, why: "Already has a draft", detail: "draft 9 in Drafts", draftId: 9, skill: "triage-mail" });
    const [single] = groupRows([row({ at: at(16, 13, 5), outcome: "drafted" })]);
    if (!single) throw new Error("no group");
    expect(groupCells(single)).toMatchObject({ count: 1, when: "13:05", what: "Drafted" });
  });

  it("a line's ref is its draft, else its client, else none", () => {
    const [d] = groupRows([row({ draftId: 3 })]);
    const [c] = groupRows([row({ draftId: null, outcome: "skipped" })]);
    const [n] = groupRows([row({ draftId: null, client: null, outcome: "skipped" })]);
    if (!d || !c || !n) throw new Error("no group");
    expect([lineRef(groupCells(d), d.rows[0]), lineRef(groupCells(c), c.rows[0]), lineRef(groupCells(n), n.rows[0])]).toEqual(["draft:3", "client:7", null]);
  });
});

describe("the timeline's day headings", () => {
  it("one heading per local day, newest first: Today, Yesterday, then the date", () => {
    const rows = [row({ at: at(20, 9, 0) }), row({ at: at(19, 20, 50) }), row({ at: at(19, 11, 5) }), row({ at: at(18, 21, 48) }), row({ at: at(16, 15, 26), outcome: "skipped" }), row({ at: at(16, 13, 5), outcome: "drafted" })];
    const days = daySections(rows, NOW);
    expect(days.map((d) => d.label)).toEqual(["Today", "Yesterday", "18 Nov", "16 Nov"]);
    expect(days.map((d) => d.groups.map((g) => g.rows.length))).toEqual([[1], [2], [1], [1, 1]]);
    expect(days[1]?.day).toBe(localDay(at(19, 11, 5)));
  });

  it("another year names the year", () => {
    expect(dayLabel("2025-11-18", NOW)).toBe("18 Nov 2025");
  });
});
