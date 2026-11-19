import { describe, expect, it } from "vitest";
import type { ActivityRowDto } from "@hub/contract/activity";
import { entryTime, groupCells, groupRows } from "../src/features/log/labels";

// Local times (the machine's zone), so the midnight case holds in any zone the tests run in.
const at = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).toISOString();
let next = 1;
const row = (over: Partial<ActivityRowDto> = {}): ActivityRowDto => ({ id: next++, runId: 1, at: at(18, 21, 48), client: { id: 7, name: "Mark Effect" }, who: "Mark Effect", outcome: "drafted", why: null, draftId: null, ...over });
const HEADING = at(18, 21, 48);

describe("activity groups", () => {
  it("consecutive entries of one client with one outcome fold into one line; a single entry stays one line", () => {
    const rows = [row(), row(), row(), row({ outcome: "skipped" }), row({ client: { id: 8, name: "Ann" }, who: "Ann" }), row()];
    expect(groupRows(rows).map((g) => g.rows.length)).toEqual([3, 1, 1, 1]);
    expect(groupRows([row()]).map((g) => g.rows.length)).toEqual([1]);
    expect(groupRows([])).toEqual([]);
  });

  it("a sender with no client row folds by its recorded name; notes never fold", () => {
    const anon = { client: null, who: "IT-Helpdesk" };
    expect(groupRows([row(anon), row(anon), row({ ...anon, who: "Other" })]).map((g) => g.rows.length)).toEqual([2, 1]);
    const note = { outcome: "other" as const, client: null, who: "Updated 3 profiles" };
    expect(groupRows([row(note), row(note)]).map((g) => g.rows.length)).toEqual([1, 1]);
  });

  it("a folded line says the count and the time range; reason and draft only when every entry shares them", () => {
    const [g] = groupRows([row({ at: at(18, 21, 48), draftId: 3 }), row({ at: at(18, 22, 5), draftId: 4 }), row({ at: at(18, 23, 10), draftId: 5 })]);
    if (!g) throw new Error("no group");
    expect(groupCells(g, HEADING)).toEqual({ who: "Mark Effect", what: "Drafted", count: 3, when: "21:48 – 23:10", why: "", detail: null, draftId: null });
    const why = "already-drafted: draft 9 in Drafts";
    const [s] = groupRows([row({ outcome: "skipped", why, draftId: 9 }), row({ outcome: "skipped", why, draftId: 9 })]);
    if (!s) throw new Error("no group");
    expect(groupCells(s, HEADING)).toMatchObject({ what: "Skipped", count: 2, why: "Already has a draft", detail: "draft 9 in Drafts", draftId: 9 });
    const [mixed] = groupRows([row({ outcome: "skipped", why }), row({ outcome: "skipped", why: "not-allowed-recipient: test" })]);
    if (!mixed) throw new Error("no group");
    expect(groupCells(mixed, HEADING)).toMatchObject({ count: 2, why: "", detail: null });
  });

  it("a time on another day than its heading carries the short date", () => {
    expect(entryTime(at(18, 23, 59), HEADING)).toBe("23:59");
    expect(entryTime(at(19, 11, 5), HEADING)).toBe("19 Nov, 11:05");
    const [g] = groupRows([row({ at: at(18, 21, 48) }), row({ at: at(19, 13, 35) })]);
    if (!g) throw new Error("no group");
    expect(groupCells(g, HEADING).when).toBe("21:48 – 19 Nov, 13:35");
    const [single] = groupRows([row({ at: at(19, 11, 5) })]);
    if (!single) throw new Error("no group");
    expect(groupCells(single, HEADING)).toMatchObject({ count: 1, when: "19 Nov, 11:05" });
  });
});
