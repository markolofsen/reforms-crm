import { describe, expect, it } from "vitest";
import type { KnowledgeEntryDto } from "@hub/contract/knowledge";
import { entriesUnder, groupEntries, hasTopic, topicItems } from "../src/features/knowledge/groups";

// P125 L2: Knowledge's menu column (`?topic=`), one nesting level, and the rows under a chosen topic.

let n = 0;
const entry = (path: string, category: string | null, brands: string[] = []): KnowledgeEntryDto => ({
  key: `knowledge:knowledge/${path}-${++n}.md`,
  title: `Entry ${n}`,
  use: "STATE",
  approved: true,
  audiences: ["CLIENT"],
  brands,
  category,
  kind: null,
  validUntil: null,
  status: "approved",
});

describe("Knowledge topics (P125 L2)", () => {
  const flat = [entry("files/a", "API"), entry("files/b", "API"), entry("files/c", "PRICING")];

  it("a flat base: one item per topic with its count, no indent, no group", () => {
    const items = topicItems(groupEntries(flat, false), false);
    expect(items.map((i) => [i.label, i.count, i.depth, i.group])).toEqual([["API", 2, 0, null], ["Pricing", 1, 0, null]]); // labels as words (P74 `topicLabel`)
    expect(items.map((i) => i.topic)).toEqual(["api", "pricing"]);
  });

  it("a topic shows only its rows; an unknown or empty topic shows every row", () => {
    const sections = groupEntries(flat, false);
    expect(entriesUnder(sections, flat, "api")).toHaveLength(2);
    expect(entriesUnder(sections, flat, "")).toHaveLength(3);
    expect(entriesUnder(sections, flat, "nope")).toHaveLength(3);
    expect(hasTopic(sections, "nope")).toBe(false);
  });

  it("brands that differ are group headings; a sub-topic is indented once and selecting its parent includes it", () => {
    const rows = [entry("playbooks/onboarding/x", null, ["A"]), entry("playbooks/y", null, ["A"]), entry("files/z", "API", ["B"])];
    const sections = groupEntries(rows, true);
    const items = topicItems(sections, true);
    expect(items.map((i) => [i.group, i.label, i.depth])).toEqual([["A", "Playbooks", 0], ["A", "Onboarding", 1], ["B", "API", 0]]);
    expect(entriesUnder(sections, rows, "a/playbooks")).toHaveLength(2);
    expect(entriesUnder(sections, rows, "a/playbooks/onboarding")).toHaveLength(1);
  });
});
