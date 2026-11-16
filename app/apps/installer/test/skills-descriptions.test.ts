import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultRoot } from "../src/context.ts";

// Decision a decision or plan record kept in the owner's instance: a description states situation, result and boundary, not trigger phrases.
const root = defaultRoot();
const skillsDir = path.join(root, "skills");
const names = readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

function frontmatter(name: string): { name?: string; description?: string } {
  const text = readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  const out: Record<string, string> = {};
  for (const line of (m?.[1] ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0 && /^[a-z-]+$/.test(line.slice(0, i))) out[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return out;
}

describe("skill descriptions state meaning", () => {
  it("finds the skills", () => expect(names.length).toBeGreaterThan(0));
  for (const name of names) {
    const fm = frontmatter(name);
    const d = fm.description ?? "";
    describe(name, () => {
      it("keeps its name", () => expect(fm.name).toBe(name));
      it("has a description of sensible length", () => {
        expect(d.length).toBeGreaterThan(80);
        expect(d.length).toBeLessThanOrEqual(700);
      });
      it("has no more than one quoted phrase", () => {
        const quoted = d.match(/"[^"]+"|«[^»]+»|“[^”]+”/g) ?? [];
        expect(quoted.length).toBeLessThanOrEqual(1);
      });
      it("is not a phrase list", () => {
        expect(d).not.toMatch(/\bPhrases?\s*[-:]/i);
        expect(d).not.toMatch(/Manual entry/i);
        expect(d).not.toMatch(/[А-Яа-яЁё]/);
      });
      it("states a boundary", () => {
        expect(d).toMatch(/\b(never|does not|read only)\b/i);
      });
      it("says how it differs from a neighbouring skill", () => {
        const others = names.filter((n) => n !== name);
        expect(others.some((n) => d.includes(n)), "name at least one other skill").toBe(true);
      });
    });
  }
});
