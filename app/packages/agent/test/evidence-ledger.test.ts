import { describe, expect, it } from "vitest";
import { entryFor, summarizeCall } from "../src/evidence/ledger";

// The session ledger (P28 B3, narrowed by P140 K2): Notion reads and creates (P82) and messenger history reads only. A mail read,
// a search or a draft is not recorded: what a draft was based on is not judged.

describe("the session ledger records only what the guard reads later (P140 K2)", () => {
  it("a mail search, a message read, a knowledge search and a draft write leave no line", () => {
    const t = (s: unknown) => [{ type: "text", text: JSON.stringify(s) }];
    expect(summarizeCall({ name: "mcp__mail-mcp__find_messages", input: { account: "a", sender: "x@y.example" }, result: t([{ id: 1 }]) })).toBeNull();
    expect(summarizeCall({ name: "mcp__mail-mcp__get_message_content", input: { message_id: 1 }, result: t({ id: 1 }) })).toBeNull();
    expect(summarizeCall({ name: "mcp__hub__knowledge_search", input: { query: "x" }, result: t([]) })).toBeNull();
    expect(summarizeCall({ name: "mcp__hub__draft_write", input: { kind: "reply", content: "Hi" }, result: t({ brand: "A" }) })).toBeNull();
    expect(entryFor({ name: "mcp__notion__notion-query-data-sources", input: { query: "Email = a@x.example" }, result: t("[]") }, "sub1")).toMatchObject({ kind: "notion", op: "query", emails: ["a@x.example"], aid: "sub1" });
  });
});

describe("where a Notion page came from (P82)", () => {
  const CLIENTS = "41806f30-6f14-81ac-b8e1-000bac534e05";
  const PAGE = "41806f306f1481d5832decbdf9d06c5e";
  it("a query records its data source and the page ids its result returned; a search records no origin", () => {
    const q = summarizeCall({ name: "mcp__notion__notion-query-data-sources", input: { data: { data_source_urls: [`collection://${CLIENTS}`] } }, result: [{ type: "text", text: JSON.stringify({ results: [{ url: `https://app.notion.com/p/${PAGE}` }] }) }] });
    expect(q).toMatchObject({ kind: "notion", op: "query", sources: ["41806f306f1481acb8e1000bac534e05"], pageIds: [PAGE] });
    const s = summarizeCall({ name: "mcp__notion__notion-search", input: { query: "Clients" }, result: [{ type: "text", text: JSON.stringify({ results: [{ id: "41806f30-6f14-81d5-832d-ecbdf9d06c5e" }] }) }] });
    expect(s?.sources).toBeUndefined();
    expect(s?.pageIds).toBeUndefined();
  });
  it("a fetch records the data source its object sits in and its own id; a create its parent", () => {
    const f = summarizeCall({ name: "mcp__notion__notion-fetch", input: { id: "41806f30-6f14-81d5-832d-ecbdf9d06c5e" }, result: [{ type: "text", text: `<parent-data-source url="collection://${CLIENTS}" name="Clients"/>` }] });
    expect(f).toMatchObject({ op: "fetch", sources: ["41806f306f1481acb8e1000bac534e05"], pageIds: [PAGE] });
    const c = summarizeCall({ name: "mcp__notion__notion-create-pages", input: { parent: { data_source_id: CLIENTS }, pages: [] }, result: [{ type: "text", text: JSON.stringify({ pages: [{ id: "41806f30-6f14-8000-8000-0000000000ff" }] }) }] });
    expect(c).toMatchObject({ op: "create", sources: ["41806f306f1481acb8e1000bac534e05"], pageIds: ["41806f306f14800080000000000000ff"] });
  });
});
