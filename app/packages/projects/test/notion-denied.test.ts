import { describe, expect, it } from "vitest";
import { auditToolCalls } from "../src/index";
import { NOTION_DENIED, notionDenial } from "../src/notion-denied";

const LAYOUT = { projects: ["projects"], db: ["data/app.db"] };
const audit = (name: string) => auditToolCalls([{ name, input: {} }], "acme", [], undefined, LAYOUT);

describe("P129 A0, P131 O4: hub audit reads the one Notion deny list", () => {
  it("names every listed tool with the guard's words, including the ones no send-like word catches", () => {
    for (const d of NOTION_DENIED) expect(audit(`mcp__notion__${d.tool}`)).toEqual([`${d.tool} is denied in every mode: ${d.why}`]);
    expect(audit("mcp__notion__notion-calendar-create-events")).toEqual([notionDenial("mcp__notion__notion-calendar-create-events")]);
  });
  it("leaves a Notion tool off the list alone, and another server's same-named tool to the generic rule", () => {
    expect(audit("mcp__notion__notion-fetch")).toEqual([]);
    expect(notionDenial("mcp__other__notion-delete-pages")).toBeNull();
  });
});
