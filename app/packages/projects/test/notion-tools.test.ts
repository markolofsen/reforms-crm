import { describe, expect, it } from "vitest";
import { auditToolCalls } from "../src/audit";
import { NOTION_ALLOWED, NOTION_DENIED, notionDenial } from "../src/notion-tools";

const LAYOUT = { projects: ["projects"], db: ["data/app.db"] };
const audit = (name: string) => auditToolCalls([{ name, input: {} }], "acme", [], undefined, LAYOUT);

describe("P129 A0, P131 O4: hub audit reads the one Notion deny list", () => {
  it("names every listed tool with the guard's words, including the ones no send-like word catches", () => {
    for (const d of NOTION_DENIED) expect(audit(`mcp__notion__${d.tool}`)).toEqual([`${d.tool} is denied in every mode: ${d.why}`]);
    expect(audit("mcp__notion__notion-calendar-create-events")).toEqual([notionDenial("mcp__notion__notion-calendar-create-events")]);
  });
  it("passes the allow-listed Notion tools, and leaves another server's same-named tool to the generic rule", () => {
    for (const t of NOTION_ALLOWED) expect(audit(`mcp__notion__${t}`)).toEqual([]);
    expect(notionDenial("mcp__other__notion-delete-pages")).toBeNull();
  });
  it("P112 S3: an unknown Notion tool fails closed, with its own sentence", () => {
    for (const t of ["notion-duplicate-page", "notion-create-comment", "notion-brand-new-tool"]) {
      expect(audit(`mcp__notion__${t}`)).toEqual([`${t} is not on the Notion allow-list, so it is denied in every mode (P112 S3: unknown Notion tools fail closed)`]);
    }
    // No tool is both allowed and denied.
    expect(NOTION_ALLOWED.filter((t) => NOTION_DENIED.some((d) => d.tool === t))).toEqual([]);
  });
});
