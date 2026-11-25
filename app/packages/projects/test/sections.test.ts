import { describe, expect, it } from "vitest";
import { headerLine, headerWidth, readTable, SECTIONS, separatorLine } from "../src/md/sections";
import { scan, splitLines } from "../src/md/scan";

// P126 P2: one spec per project.md section; trailing columns past `required` are optional.

const doc = (body: string) => splitLines(`# X\n\n${body}\n`);

describe("SECTIONS specs", () => {
  it("the writer's header line has every column and a matching separator", () => {
    expect(headerLine(SECTIONS.brands)).toBe("| Brand | Receives at | Signature | Answered | By | Display name | Booking |");
    expect(separatorLine(SECTIONS.links)).toBe("|---|---|---|---|---|---|");
    expect(headerLine(SECTIONS.settings)).toBe("| Field | Value | Answered | By |");
  });

  it("a header may stop before the optional trailing columns, never before a required one", () => {
    const five = ["Brand", "Receives at", "Signature", "Answered", "By"];
    expect(headerWidth(SECTIONS.brands, five)).toBe(5);
    expect(headerWidth(SECTIONS.brands, [...five, "display name"])).toBe(6);
    expect(headerWidth(SECTIONS.brands, five.slice(0, 4))).toBeNull();
    expect(headerWidth(SECTIONS.brands, [...five, "Display name", "Extra"])).toBeNull();
    expect(headerWidth(SECTIONS.settings, ["Field", "Value", "Answered"])).toBeNull();
  });

  it("rows are padded to every column, so a five-column Brands row reads Display name and Booking as empty", () => {
    const lines = doc("## Brands\n\n| Brand | Receives at | Signature | Answered | By |\n|---|---|---|---|---|\n| A | a@x.test | A | 2026-11-23 | owner |");
    const t = readTable(lines, scan(lines), SECTIONS.brands);
    expect(t?.issues).toEqual([]);
    expect(t?.rows[0]?.cells).toEqual(["A", "a@x.test", "A", "2026-11-23", "owner", "", ""]);
  });

  it("a row whose cell count differs from its header is one issue with the spec's code and field", () => {
    const lines = doc("## Links\n\n| Group | Label | Target | Under | Answered | By |\n|---|---|---|---|---|---|\n| G | L | https://x.test |");
    const t = readTable(lines, scan(lines), SECTIONS.links);
    expect(t?.rows).toEqual([]);
    expect(t?.issues.map((i) => [i.code, i.field])).toEqual([["bad_link", "links"]]);
  });

  it("a missing section is null; Answers without a table is valid and empty", () => {
    const lines = doc("## Answers\n\nnone yet");
    expect(readTable(lines, scan(lines), SECTIONS.settings)).toBeNull();
    expect(readTable(lines, scan(lines), SECTIONS.answers)).toMatchObject({ rows: [], issues: [], bad: false });
  });

  it("a wrong header names the required columns and the optional ones", () => {
    const lines = doc("## Brands\n\n| Brand | Domains |\n|---|---|");
    const t = readTable(lines, scan(lines), SECTIONS.brands);
    expect(t?.bad).toBe(true);
    expect(t?.issues[0]?.message).toBe("## Brands needs a table with the columns Brand | Receives at | Signature | Answered | By, with optional Display name | Booking");
  });
});
