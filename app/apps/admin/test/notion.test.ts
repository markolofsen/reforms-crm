import { describe, expect, it } from "vitest";
import { notionOf } from "../src/lib/notion";

const ID = "0123456789abcdef0123456789abcdef";
const d = (o: Partial<{ notionKind: "client" | "lead" | "none" | null; notionPageId: string | null; notionUrl: string | null }>) => ({ notionKind: null, notionPageId: null, notionUrl: null, ...o });

describe("notionOf", () => {
  it("tells a lead page from a client page and builds the links from the id", () => {
    expect(notionOf(d({ notionKind: "lead", notionPageId: ID }))).toEqual({ kind: "lead", label: "Lead page in Notion", web: `https://www.notion.so/${ID}`, app: `notion://www.notion.so/${ID}` });
    expect(notionOf(d({ notionKind: "client", notionUrl: "https://www.notion.so/x" }))).toMatchObject({ kind: "client", label: "Client page in Notion", web: "https://www.notion.so/x", app: null });
  });
  it("none says there is no page; a record from before the kind keeps its link without a badge", () => {
    expect(notionOf(d({ notionKind: "none" }))).toMatchObject({ kind: "none", web: null, label: "No Notion page yet" });
    expect(notionOf(d({ notionUrl: "https://www.notion.so/y" }))).toMatchObject({ kind: null, label: "Notion profile" });
    expect(notionOf(d({}))).toMatchObject({ kind: null, web: null, label: "No Notion profile found" });
  });
});
