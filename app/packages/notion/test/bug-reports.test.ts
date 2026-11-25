import { describe, expect, it } from "vitest";
import { areaOption, entryBlocks, fileBugReport, messageMark, normalArea, type BugReportInput, type BugReportWriter } from "../src/bug-reports";
import type { DataSourceInfo, NotionReader, PageObject } from "../src/types";

// P145 B3 (verdicts 15 and 17, decision 0054): search the open reports of the area and project, append to one, create with
// Status New when there is none, answer the candidates when there are several; one entry per message; never Severity, Notes,
// Fix link or a Status but New.
const opts = (...names: string[]) => ({ options: names.map((name) => ({ name })) });
const DS: DataSourceInfo = {
  id: "bugs",
  title: "Bug reports",
  properties: {
    Bug: { type: "title" },
    Projects: { type: "multi_select", multi_select: opts("Shop One", "Other Site") },
    Clients: { type: "relation" },
    Channel: { type: "select", select: opts("Mail", "WhatsApp", "Telegram", "Other") },
    "Source link": { type: "url" },
    "Client's words": { type: "rich_text" },
    Evidence: { type: "rich_text" },
    Area: { type: "select", select: opts("parser: source-a") },
    Status: { type: "select", select: opts("New", "Triaged", "In progress", "Fixed") },
    Severity: { type: "select", select: opts("High") },
    "Reported at": { type: "date" },
    "Last reported": { type: "date" },
    Notes: { type: "rich_text" },
  },
};
const report = (id: string, projects: string[], clients: string[] = []): PageObject => ({ id, last_edited_time: "x", parent: { data_source_id: "bugs" }, properties: { Bug: { type: "title", title: [{ plain_text: `bug ${id}` }] }, Projects: { type: "multi_select", multi_select: projects.map((name) => ({ name })) }, Clients: { type: "relation", relation: clients.map((x) => ({ id: x })) } } });
const input = (o: Partial<BugReportInput> = {}): BugReportInput => ({ project: "shop-one", area: "Parser: Source-A", symptom: "Gallery shows another car's photos", words: "the photos are of other cars", evidence: ["https://example.test/car/1"], channel: "WhatsApp", sourceLink: "http://127.0.0.1:5173/p/messengers/c/12", clientPageId: "client-2", messageKey: "p:msg-1", at: "2026-11-25T10:00:00.000Z", ...o });

function fake(open: PageObject[], bodies: Record<string, string[]> = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const filters: unknown[] = [];
  const reader: NotionReader = {
    retrieveDataSource: async () => DS,
    async *listPages() {},
    findPages: async (_id, filter) => (filters.push(filter), open),
    retrieveMarkdown: async () => ({ markdown: "", truncated: false, unknownBlockIds: [] }),
  };
  const writer: BugReportWriter = {
    create: async (...a) => (calls.push(["create", ...a]), "new-report"),
    update: async (...a) => void calls.push(["update", ...a]),
    retrievePage: async (id) => open.find((p) => p.id === id) ?? report(id, []),
    blocks: async (id) => (bodies[id] ?? []).map((text, i) => ({ id: `b${i}`, type: "bulleted_list_item", text })),
    append: async (...a) => void calls.push(["append", ...a]),
  };
  return { reader, writer, calls, filters };
}

describe("the Area", () => {
  it("has one normal form and reuses the option that has it", () => {
    expect(normalArea("  Parser:OpenX ")).toBe("parser: openx");
    expect(areaOption(["parser: source-a"], "PARSER :  Source-A")).toBe("parser: source-a");
    expect(areaOption(["parser: source-a"], "site: example.test")).toBe("site: example.test");
  });
});

describe("fileBugReport", () => {
  it("no open report: creates one with Status New, the client, the words and the evidence, never Severity or Notes", async () => {
    const f = fake([]);
    const r = await fileBugReport(f, { dataSourceId: "bugs" }, input());
    expect(r).toEqual({ state: "created", pageId: "new-report", note: null });
    const [, ds, props, children] = f.calls[0] as [string, string, Record<string, unknown>, unknown[]];
    expect(ds).toBe("bugs");
    expect(props).toMatchObject({ Projects: { multi_select: [{ name: "Shop One" }] }, Clients: { relation: [{ id: "client-2" }] }, Channel: { select: { name: "WhatsApp" } }, Area: { select: { name: "parser: source-a" } }, Status: { select: { name: "New" } }, "Reported at": { date: { start: "2026-11-25T10:00:00.000Z" } } });
    expect(Object.keys(props)).not.toEqual(expect.arrayContaining(["Severity"]));
    expect(Object.keys(props)).not.toContain("Notes");
    expect(Object.keys(props)).not.toContain("Fix link");
    expect(JSON.stringify(children)).toContain(messageMark("p:msg-1"));
    expect(f.filters[0]).toMatchObject({ and: [{ property: "Area", select: { equals: "parser: source-a" } }, { or: [{ select: { equals: "New" } }, { select: { equals: "Triaged" } }, { select: { equals: "In progress" } }] }] });
  });

  it("one open report of the area and project: a second client is appended, never filed again", async () => {
    const f = fake([report("r1", ["Shop One"], ["client-1"]), report("r2", ["Other Site"])]);
    const r = await fileBugReport(f, { dataSourceId: "bugs" }, input());
    expect(r).toEqual({ state: "appended", pageId: "r1", note: null });
    expect(f.calls.map((c) => c[0])).toEqual(["update", "append"]);
    expect(f.calls[0]).toEqual(["update", "r1", { Clients: { relation: [{ id: "client-1" }, { id: "client-2" }] }, "Last reported": { date: { start: "2026-11-25T10:00:00.000Z" } } }]);
    expect(f.calls[1]).toEqual(["append", "r1", entryBlocks(input())]);
  });

  it("the same message filed twice is one entry", async () => {
    const f = fake([report("r1", ["Shop One"], ["client-2"])], { r1: [`2026-11-25 · WhatsApp · "the photos" ${messageMark("p:msg-1")}`] });
    expect(await fileBugReport(f, { dataSourceId: "bugs" }, input())).toEqual({ state: "already", pageId: "r1", note: null });
    expect(f.calls).toEqual([]);
  });

  it("several open reports: creates nothing and lists them; into picks one", async () => {
    const f = fake([report("r1", ["Shop One"]), report("r3", ["Shop One"])]);
    expect(await fileBugReport(f, { dataSourceId: "bugs" }, input())).toEqual({ state: "several", candidates: [{ pageId: "r1", bug: "bug r1" }, { pageId: "r3", bug: "bug r3" }] });
    expect(f.calls).toEqual([]);
    expect((await fileBugReport(f, { dataSourceId: "bugs" }, input({ into: "r3" }))).state).toBe("appended");
  });

  it("a new Area is not searched; a project with no option is filed without it, with a note", async () => {
    const f = fake([report("r1", ["Shop One"])]);
    const r = await fileBugReport(f, { dataSourceId: "bugs" }, input({ area: "site: example.test", project: "unknown-project" }));
    expect(r.state).toBe("created");
    expect(r.state === "created" && r.note).toMatch(/no Projects option for unknown-project/);
    expect(f.filters).toEqual([]);
    expect(Object.keys((f.calls[0] as [string, string, Record<string, unknown>])[2])).not.toContain("Projects");
  });
});

describe("Kind (P147 3g)", () => {
  const KINDED: DataSourceInfo = { ...DS, properties: { ...DS.properties, Kind: { type: "select", select: opts("Product", "Knowledge gap", "Workflow") }, Area: { type: "select", select: opts("parser: source-a", "knowledge: japanese auctions") } } };
  const kinded = (open: PageObject[]) => {
    const f = fake(open);
    return { ...f, reader: { ...f.reader, retrieveDataSource: async () => KINDED } };
  };
  it("a new gap is created with its Kind; the search keys on Kind plus Area", async () => {
    const f = kinded([]);
    await fileBugReport(f, { dataSourceId: "bugs" }, input({ kind: "Knowledge gap", area: "knowledge: Japanese auctions" }));
    expect(JSON.stringify(f.filters[0])).toContain('"property":"Kind","select":{"equals":"Knowledge gap"}');
    expect((f.calls[0]?.[2] as Record<string, unknown>)["Kind"]).toEqual({ select: { name: "Knowledge gap" } });
  });
  it("Product also matches the rows with no Kind (they are Product)", async () => {
    const f = kinded([report("old", ["Shop One"])]);
    const r = await fileBugReport(f, { dataSourceId: "bugs" }, input());
    expect(r).toMatchObject({ state: "appended", pageId: "old" });
    expect(JSON.stringify(f.filters[0])).toContain('"is_empty":true');
  });
});
