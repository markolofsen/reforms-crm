import { describe, expect, it } from "vitest";
import type { KnowledgeEntryDto } from "@hub/contract/knowledge";
import { ALL_BRANDS, groupEntries } from "../src/features/knowledge/groups";
import { facetsOf } from "../src/features/knowledge/labels";

// P74: the Knowledge table under a heading per topic. Fixtures shaped like the two live bases (2026-11-20): a flat base of 57
// entries in 9 categories, and a foldered one whose playbooks folder holds sub-folders.

let n = 0;
const entry = (path: string, category: string | null, brands: string[] = [], title = `Entry ${++n}`): KnowledgeEntryDto => ({
  key: `knowledge:knowledge/${path}`,
  title,
  use: "STATE",
  approved: true,
  audiences: ["CLIENT"],
  brands,
  category,
  kind: null,
  validUntil: null,
  status: "approved",
});
const many = (k: number, make: (i: number) => KnowledgeEntryDto) => Array.from({ length: k }, (_, i) => make(i));

const FLAT: Record<string, number> = { API: 10, PRICING: 9, DATA: 9, BILLING: 9, SOURCES: 6, PRODUCT: 6, SUPPORT: 4, TERMS: 3, ABOUT: 1 };
const flat = Object.entries(FLAT).flatMap(([cat, k]) => many(k, (i) => entry(`files/${cat.toLowerCase()}-${i}-41806f30.md`, cat, ["Carapis"])));

describe("Knowledge grouped by topic (P74)", () => {
  it("a flat base: one heading per category, in label order, counts summing to every row, no brand level", () => {
    expect(flat).toHaveLength(57);
    const s = groupEntries(flat, facetsOf(flat).brandsDiffer);
    expect(s.map((x) => x.label)).toEqual(["About", "API", "Billing", "Data", "Pricing", "Product", "Sources", "Support", "Terms"]);
    expect(s.map((x) => x.count)).toEqual([1, 10, 9, 9, 9, 6, 6, 4, 3]);
    expect(s.every((x) => x.depth === 0 && x.entries.length === x.count)).toBe(true);
  });

  it("a foldered base: the top folders, a folder's own rows before its sub-folders, sub-headings one level down", () => {
    const rows = [
      ...many(3, (i) => entry(`files/buying/b${i}.md`, "BUYING")),
      entry("files/playbooks/p.md", "PLAYBOOK"),
      ...many(4, (i) => entry(`files/playbooks/client/c${i}.md`, "PLAYBOOK")),
      ...many(2, (i) => entry(`files/playbooks/lead/l${i}.md`, "PLAYBOOK")),
      entry("files/about-dan/d.md", "ABOUT_DAN"),
    ];
    const s = groupEntries(rows, false);
    expect(s.map((x) => [x.label, x.depth, x.count, x.entries.length])).toEqual([
      ["About dan", 0, 1, 1],
      ["Buying", 0, 3, 3],
      ["Playbooks", 0, 7, 1],
      ["Client", 1, 4, 4],
      ["Lead", 1, 2, 2],
    ]);
  });

  it("brands that differ: a brand level on top, All brands first, an entry with two brands under each", () => {
    const rows = [entry("files/a.md", "PRICING", ["Toponimo"]), entry("files/b.md", "PRICING", ["ANY"]), entry("files/c.md", "API", ["Carapis", "Toponimo"])];
    expect(facetsOf(rows).brandsDiffer).toBe(true);
    const s = groupEntries(rows, true);
    expect(s.map((x) => `${"  ".repeat(x.depth)}${x.label} ${x.count}`)).toEqual([`${ALL_BRANDS} 1`, "  Pricing 1", "Carapis 1", "  API 1", "Toponimo 2", "  API 1", "  Pricing 1"]);
    expect(new Set(s.map((x) => x.id)).size).toBe(s.length);
  });

  it("a search that matches one group draws one heading; a folder and a category of the same name meet; no category is Other, last", () => {
    expect(groupEntries(flat.filter((e) => e.category === "ABOUT"), false).map((x) => [x.label, x.count])).toEqual([["About", 1]]);
    const mixed = [entry("files/pricing/a.md", "PRICING"), entry("files/b.md", "PRICING"), entry("files/c.md", null), entry("files/d.md", "ZONES")];
    expect(groupEntries(mixed, false).map((x) => [x.label, x.count])).toEqual([["Pricing", 2], ["Zones", 1], ["Other", 1]]);
    expect(groupEntries([], false)).toEqual([]);
  });
});
