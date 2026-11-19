import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SAY } from "@hub/contract/help";
import { defaultRoot } from "../src/context";

// P63 O3: Help's phrases are the README's "Example" column, word for word, so the two copies cannot drift.
const root = defaultRoot();
const readme = readFileSync(path.join(root, "skills", "README.md"), "utf8");
/** Each skills-table row: its examples (the backticked phrases of the first cell) and the skill named in the second. */
const rows = readme.split("\n").filter((l) => l.startsWith("| `")).map((l) => {
  const cells = l.split("|").map((c) => c.trim());
  return { examples: [...(cells[1] ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1]), skill: /`([a-z-]+)`/.exec(cells[2] ?? "")?.[1] };
});

describe("Help's phrases (P63 O3)", () => {
  it("reads the README table", () => expect(rows.length).toBeGreaterThan(10));
  for (const s of SAY) {
    it(`${s.skill}: "${s.example}" is in its README row`, () => {
      expect(existsSync(path.join(root, "skills", s.skill, "SKILL.md")), "the skill exists").toBe(true);
      expect(rows.some((r) => r.skill === s.skill && r.examples.includes(s.example))).toBe(true);
    });
  }
});
