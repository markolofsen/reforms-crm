import { describe, expect, it } from "vitest";
import { notionOf } from "../src/lib/notion";

const ID = "0123456789abcdef0123456789abcdef";
const d = (o: Partial<{ notionKind: "client" | "lead" | "none" | null; notionPageId: string | null; notionUrl: string | null }>) => ({ notionKind: null, notionPageId: null, notionUrl: null, ...o });

describe("notionOf", () => {
  it("tells a lead page from a client page and builds the links from the id", () => {
    // P131: the web page only; whether the Notion app opens it is decided at render (`useOpenLink`).
    expect(notionOf(d({ notionKind: "lead", notionPageId: ID }))).toEqual({ kind: "lead", label: "Lead page in Notion", web: `https://www.notion.so/${ID}` });
    // The agent's own url is kept when the destinations table knows it (a slug, a view)...
    expect(notionOf(d({ notionKind: "client", notionUrl: `https://www.notion.so/Acme-${ID}?v=1` }))).toMatchObject({ kind: "client", label: "Client page in Notion", web: `https://www.notion.so/Acme-${ID}?v=1` });
    // ...and an address that is no page link opens nothing, or the page by its id.
    expect(notionOf(d({ notionKind: "client", notionUrl: "https://www.notion.so/x" }))).toMatchObject({ web: null, label: "No Notion page yet" });
    expect(notionOf(d({ notionKind: "client", notionUrl: "https://www.notion.so/x", notionPageId: ID }))).toMatchObject({ web: `https://www.notion.so/${ID}` });
  });
  it("none says there is no page; a record from before the kind keeps its link without a badge", () => {
    expect(notionOf(d({ notionKind: "none" }))).toMatchObject({ kind: "none", web: null, label: "No Notion page yet" });
    expect(notionOf(d({ notionUrl: `https://www.notion.so/${ID}` }))).toMatchObject({ kind: null, label: "Notion profile" });
    expect(notionOf(d({}))).toMatchObject({ kind: null, web: null, label: "No Notion profile found" });
  });
});
