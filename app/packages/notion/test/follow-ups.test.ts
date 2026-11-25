import { describe, expect, it } from "vitest";
import { CRM_FOLLOW_UP_FIELDS, followUpProperties, writeFollowUp, type FollowUpPlanCopy, type FollowUpWriter } from "../src/follow-ups";
import type { MapBlock } from "../src/client-map";
import type { NotionReader, PropertyConfig } from "../src/types";

// P142 F7 (verdicts 12, 13): the plan's Notion copy. The four Hub properties are set when the database has them; one dated line is
// appended under "Follow-ups" (the heading made once, newest last, never rewritten); no CRM-owned field is ever written.
function reader(props: Record<string, PropertyConfig>): NotionReader {
  return {
    retrieveDataSource: async (id) => ({ id, title: "Clients", properties: { Name: { type: "title" }, Email: { type: "email" }, ...props } }),
    async *listPages() {},
    findPages: async () => [],
    retrieveMarkdown: async () => ({ markdown: "", truncated: false, unknownBlockIds: [] }),
  };
}
function writer(blocks: MapBlock[]): FollowUpWriter & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return { calls, blocks: async () => blocks, setProperties: async (...a) => void calls.push(["props", ...a]), append: async (...a) => void calls.push(["append", ...a]) };
}
const ALL = { "Next follow-up": { type: "date" }, "Follow-up status": { type: "select" }, "Follow-ups sent": { type: "number" }, "Waiting on": { type: "select" }, "Follow-up on": { type: "date" } } as Record<string, PropertyConfig>;
const PLAN: FollowUpPlanCopy = { nextAt: "2026-11-30", state: "waiting", nudgeReady: true, nudgesSent: 2, waitingOn: "them", line: "2026-11-25 · WhatsApp · 2-й follow-up · проверка 2026-11-30" };

describe("the follow-up copy", () => {
  it("sets the four properties and never a CRM-owned one", () => {
    const p = followUpProperties(ALL, PLAN);
    expect(p).toEqual({ "Next follow-up": { date: { start: "2026-11-30" } }, "Follow-up status": { select: { name: "Nudge ready" } }, "Follow-ups sent": { number: 2 }, "Waiting on": { select: { name: "Them" } } });
    for (const f of CRM_FOLLOW_UP_FIELDS) expect(Object.keys(p)).not.toContain(f);
    expect(followUpProperties(ALL, { ...PLAN, state: "answered", nudgeReady: false, nudgesSent: 0 })["Next follow-up"]).toEqual({ date: null });
  });
  it("makes the heading once at the end, then appends each new line after the last one of its section", async () => {
    const fresh = writer([{ id: "n1", type: "paragraph", text: "notes" }]);
    const r = await writeFollowUp({ reader: reader(ALL), writer: fresh }, { clientsDataSource: "ds", pageId: "p1", plan: PLAN });
    expect(r).toMatchObject({ state: "synced", pageId: "p1", properties: 4, line: "appended" });
    expect(fresh.calls.at(-1)).toEqual(["append", "p1", [PLAN.line], { heading: true }]);
    const later = writer([{ id: "h1", type: "heading_2", text: "Follow-ups" }, { id: "l1", type: "bulleted_list_item", text: "old" }, { id: "h2", type: "heading_2", text: "Client map" }]);
    await writeFollowUp({ reader: reader(ALL), writer: later }, { clientsDataSource: "ds", pageId: "p1", plan: PLAN });
    expect(later.calls.at(-1)).toEqual(["append", "p1", [PLAN.line], { heading: false, after: "l1" }]);
  });
  it("a same-day replace (no line) sets the properties only; a database without them is skipped cleanly", async () => {
    const w = writer([]);
    await writeFollowUp({ reader: reader(ALL), writer: w }, { clientsDataSource: "ds", pageId: "p1", plan: { ...PLAN, line: null } });
    expect(w.calls.map((c) => c[0])).toEqual(["props"]);
    const none = writer([]);
    expect(await writeFollowUp({ reader: reader({}), writer: none }, { clientsDataSource: "ds", pageId: "p1", plan: { ...PLAN, line: null } })).toMatchObject({ state: "skipped", reason: "no_properties" });
    expect(none.calls).toEqual([]);
  });
});
