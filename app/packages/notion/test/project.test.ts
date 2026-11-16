import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProject, normalizeId, parseProject } from "../src/project.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("parseProject", () => {
  it("reads the name and one database per list item", () => {
    const p = parseProject(
      "# acme\n\nSome prose.\n\n- clients: aaaa1111-0000-4000-8000-000000000001\n- leads: AAAA2222000040008000000000000002 note\n",
      "/x/acme",
    );
    expect(p.name).toBe("acme");
    expect(p.databases).toEqual([
      { slug: "clients", dataSourceId: "aaaa1111-0000-4000-8000-000000000001" },
      { slug: "leads", dataSourceId: "aaaa2222-0000-4000-8000-000000000002" },
    ]);
  });

  it("falls back to the folder name", () => {
    expect(parseProject("- a: 11111111-1111-1111-1111-111111111111", "/x/folder").name).toBe("folder");
  });

  it("ignores fenced code and prose lines", () => {
    const p = parseProject("```\n- skipped: nope\n```\n- kept: 11111111-1111-1111-1111-111111111111\n", "/x");
    expect(p.databases.map((d) => d.slug)).toEqual(["kept"]);
  });

  it("refuses a database without a valid id instead of skipping it", () => {
    expect(() => parseProject("- clients: not-an-id", "/x")).toThrow(/clients/);
  });

  it("refuses duplicate slugs and empty lists", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    expect(() => parseProject(`- a: ${id}\n- a: ${id}`, "/x")).toThrow(/duplicate/);
    expect(() => parseProject("# nothing", "/x")).toThrow(/no databases/);
  });

  it("normalizes ids", () => {
    expect(normalizeId("ABCDEF0123456789ABCDEF0123456789")).toBe("abcdef01-2345-6789-abcd-ef0123456789");
  });
});

describe("schema v1 project.md", () => {
  const id = "11111111-1111-1111-1111-111111111111";
  const v1 = [
    "# Acme",
    "",
    "## Settings",
    "",
    "| Field | Value | Answered | By |",
    "|---|---|---|---|",
    "| tone | warm: brief | 2026-11-14 | owner |",
    "",
    "## Notion databases",
    "",
    `- clients: ${id}`,
    "",
    "## Notes",
    "",
    "A sentence. The table above is not a database list.",
    "",
  ].join("\n");

  it("reads databases only from its heading; the Settings table is invisible", () => {
    const p = parseProject(v1, "/x/acme");
    expect(p.name).toBe("Acme");
    expect(p.databases).toEqual([{ slug: "clients", dataSourceId: id }]);
  });

  it("refuses a `- key: value` item outside the heading instead of reading it as a database", () => {
    expect(() => parseProject(`${v1}\n- reminder: call Sam\n`, "/x")).toThrow(/outside "## Notion databases"/);
  });
});

describe("project fixture", () => {
  it("acme lists the five CRM databases", async () => {
    const p = await loadProject(join(here, "fixtures", "acme"));
    expect(p.databases.map((d) => d.slug)).toEqual(["clients", "leads", "workflows", "knowledge", "reports"]);
  });
});
