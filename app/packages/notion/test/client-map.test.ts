import { describe, expect, it } from "vitest";
import { createMapWriter, MAP_DATE_FIELD, MAP_HEADING, NEXT_STEP_FIELD, richTextChunks, writeClientMap, type MapBlock, type MapWriter } from "../src/client-map";
import type { NotionReader, PageObject, PropertyConfig } from "../src/types";

// P135 K5: the client map's Notion copy. The Hub's section (a "Client map" heading and one mermaid code block) is edited in place,
// appended when absent, the rest of the page untouched and nothing deleted; "Map updated" is set when the database has it.
const page = (id: string, mail: string): PageObject => ({ id, last_edited_time: "2026-11-20T00:00:00.000Z", properties: { Email: { type: "email", email: mail } } });
function reader(props: Record<string, PropertyConfig>, pages: PageObject[]): NotionReader {
  return {
    retrieveDataSource: async (id) => ({ id, title: "Clients", properties: { Name: { type: "title" }, Email: { type: "email" }, ...props } }),
    async *listPages() { yield* pages; },
    findPages: async () => pages,
    retrieveMarkdown: async () => ({ markdown: "", truncated: false, unknownBlockIds: [] }),
  };
}
function writer(blocks: MapBlock[]): MapWriter & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return { calls, blocks: async () => blocks, updateCode: async (...a) => void calls.push(["update", ...a]), append: async (...a) => void calls.push(["append", ...a]), setDate: async (...a) => void calls.push(["date", ...a]), setNextStep: async (...a) => void calls.push(["next", ...a]) };
}
const DATE = { [MAP_DATE_FIELD]: { type: "date" } };
const AT = "2026-11-24T10:00:00.000Z";
const NOTES: MapBlock = { id: "n1", type: "paragraph", text: "Owner notes" };

describe("writeClientMap", () => {
  it("edits the Hub's code block in place and sets Map updated", async () => {
    const w = writer([NOTES, { id: "h1", type: "heading_2", text: MAP_HEADING }, { id: "c1", type: "code", text: "old", language: "mermaid" }]);
    const r = await writeClientMap({ reader: reader(DATE, [page("p1", "ann@x.example")]), writer: w }, { clientsDataSource: "ds", email: "ann@x.example", text: "flowchart TD", at: AT });
    expect(r).toEqual({ state: "synced", pageId: "p1", block: "updated", nextStep: "no_field" });
    expect(w.calls).toEqual([["update", "c1", "flowchart TD"], ["date", "p1", AT]]);
  });
  it("appends the section when the page has none, the code alone after a lone heading; no date without the property", async () => {
    const fresh = writer([NOTES]);
    await writeClientMap({ reader: reader({}, [page("p1", "ann@x.example")]), writer: fresh }, { clientsDataSource: "ds", email: "ann@x.example", text: "m", at: AT });
    expect(fresh.calls).toEqual([["append", "p1", "m", undefined]]);
    const lone = writer([{ id: "h1", type: "heading_2", text: MAP_HEADING }, NOTES]);
    await writeClientMap({ reader: reader(DATE, [page("p1", "ann@x.example")]), writer: lone }, { clientsDataSource: "ds", email: "ann@x.example", text: "m", at: AT });
    expect(lone.calls).toEqual([["append", "p1", "m", "h1"], ["date", "p1", AT]]);
  });
  it("sets Next step from the map when the database has it as text, and leaves it when the map has nothing open (P136)", async () => {
    const props = { ...DATE, [NEXT_STEP_FIELD]: { type: "rich_text" } };
    const w = writer([]);
    const r = await writeClientMap({ reader: reader(props, [page("p1", "ann@x.example")]), writer: w }, { clientsDataSource: "ds", email: "ann@x.example", text: "m", at: AT, nextStep: "Sign by 2026-11-30" });
    expect(r).toMatchObject({ nextStep: "set" });
    expect(w.calls).toContainEqual(["next", "p1", "Sign by 2026-11-30"]);
    const idle = writer([]);
    expect(await writeClientMap({ reader: reader(props, [page("p1", "ann@x.example")]), writer: idle }, { clientsDataSource: "ds", email: "ann@x.example", text: "m", at: AT, nextStep: null })).toMatchObject({ nextStep: "none" });
    expect(idle.calls.some((c) => c[0] === "next")).toBe(false);
    const dated = writer([]);
    await writeClientMap({ reader: reader({ [NEXT_STEP_FIELD]: { type: "date" } }, [page("p1", "ann@x.example")]), writer: dated }, { clientsDataSource: "ds", email: "ann@x.example", text: "m", at: AT, nextStep: "Call" });
    expect(dated.calls.some((c) => c[0] === "next")).toBe(false);
  });
  it("writes nothing for an address that is no client", async () => {
    const w = writer([]);
    expect(await writeClientMap({ reader: reader(DATE, [page("p1", "ann@x.example")]), writer: w }, { clientsDataSource: "ds", email: "bob@x.example", text: "m", at: AT })).toMatchObject({ state: "skipped", reason: "not_client" });
    expect(w.calls).toEqual([]);
  });
});

describe("the map writer", () => {
  it("splits a long text into rich text items of at most 2,000 UTF-16 units, never inside a surrogate pair", () => {
    const text = `${"a".repeat(1999)}😀${"b".repeat(10)}`;
    const items = richTextChunks(text);
    expect(items.map((i) => i.text.content.length)).toEqual([1999, 12]);
    expect(items.map((i) => i.text.content).join("")).toBe(text);
  });
  it("updates a code block with PATCH /blocks and appends with PATCH /blocks/:page/children; never DELETE", async () => {
    const seen: Array<{ url: string; method: string; body: unknown }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ object: "block", id: "c1", results: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const w = createMapWriter("t", { fetch: fetcher });
    await w.updateCode("c1", "flowchart TD");
    await w.append("p1", "flowchart TD");
    expect(seen.map((s) => `${s.method} ${new URL(s.url).pathname}`)).toEqual(["PATCH /v1/blocks/c1", "PATCH /v1/blocks/p1/children"]);
    expect(seen[0]!.body).toEqual({ code: { language: "mermaid", rich_text: [{ type: "text", text: { content: "flowchart TD" } }] } });
    expect(JSON.stringify(seen[1]!.body)).toContain(MAP_HEADING);
  });
});
