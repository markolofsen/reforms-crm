import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FILE_LINE_CAP, FUNCTION_LINE_CAP } from "../lint-limits.mjs";

// A rule is cited by page and number (`routes-and-url-state.md` rule 10, or `(rules: state-and-data 7)` in an eslint message).
// Rule pages are renumbered and renamed; a citation that points at nothing sends an agent to the wrong rule (process audit 2026-11-17, 3.2 and 3.5).
// Cited forms checked here:
//   `<page>` rule N       `<page>.md` rules N-M       (rules: <page> N, <page2> M)       `@rules/README.md` rule N
const admin = path.resolve(import.meta.dirname, "..");
const app = path.resolve(admin, "../..");
const rulesDir = path.join(app, "@rules");

const pageNames = readdirSync(rulesDir).filter((f) => f.endsWith(".md") && f !== "SOURCE.md").map((f) => f.replace(/\.md$/, ""));
const numbered = (page: string) => {
  const text = readFileSync(path.join(rulesDir, `${page}.md`), "utf8");
  const body = page === "README" ? text.slice(text.indexOf("## Standing rules")) : text;
  return new Set([...body.matchAll(/^(\d+[a-z]?)\. /gm)].map((m) => m[1]!));
};

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    if (["node_modules", ".next", ".next-e2e", ".next-build-check", "test-results", "playwright-report", "dist"].includes(e)) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}
const SKIP = /[\\/]components[\\/]ui[\\/]|[\\/]\.live[\\/]|rule-citations\.test\.ts$/;
const sourceFiles = [
  ...[...walk(path.join(app, "apps")), ...walk(path.join(app, "packages"))].filter((p) => /\.(tsx?|mjs|css)$/.test(p) && !/\.d\.mts$/.test(p)),
  ...readdirSync(rulesDir).filter((f) => f.endsWith(".md")).map((f) => path.join(rulesDir, f)),
].filter((p) => !SKIP.test(p));

type Cite = { page: string; nums: string[]; at: string };
function citations(file: string): Cite[] {
  const text = readFileSync(file, "utf8");
  const out: Cite[] = [];
  const at = (i: number) => `${path.relative(app, file)}:${text.slice(0, i).split("\n").length}`;
  const range = (a: string, b?: string) => {
    if (!b) return [a];
    const [x, y] = [parseInt(a, 10), parseInt(b, 10)];
    return Array.from({ length: y - x + 1 }, (_, k) => String(x + k));
  };
  // Form 1: `<page>` rule N, `<page>.md` rules N-M, @rules/<page>.md rule N. A bare word needs a hyphen or `.md` to count as a page name.
  for (const m of text.matchAll(/(?:@rules\/)?\b((?:[A-Za-z]+(?:-[A-Za-z]+)+)|(?:[A-Za-z]+\.md))\b(?:\.md)?`? rules? (\d+[a-z]?)(?:-(\d+[a-z]?))?/g)) {
    out.push({ page: m[1]!.replace(/\.md$/, ""), nums: range(m[2]!, m[3]), at: at(m.index ?? 0) });
  }
  // Form 2: `(rules: page N, page2 M)` as eslint messages and code comments write it; a page with no number is a page-only citation.
  for (const m of text.matchAll(/\(rules?: ((?:[a-z][a-z-]*(?: \d+[a-z]?(?:-\d+[a-z]?)?)?(?:, )?)+)/g)) {
    for (const part of m[1]!.split(", ")) {
      const mm = /^([a-z][a-z-]*)(?: (\d+[a-z]?)(?:-(\d+[a-z]?))?)?$/.exec(part);
      if (mm) out.push({ page: mm[1]!, nums: mm[2] ? range(mm[2], mm[3]) : [], at: at(m.index ?? 0) });
    }
  }
  return out;
}

describe("rule citations resolve (rules: agent-guardrails 1)", () => {
  const all = sourceFiles.flatMap(citations);
  it("finds citations to check (the scan is not empty)", () => {
    expect(all.length).toBeGreaterThan(20);
  });
  it("every cited page exists", () => {
    expect(all.filter((c) => !pageNames.includes(c.page)).map((c) => `${c.at}: no page "${c.page}"`)).toEqual([]);
  });
  it("every cited rule number exists on its page", () => {
    const bad = all.filter((c) => pageNames.includes(c.page)).flatMap((c) => c.nums.filter((n) => !numbered(c.page).has(n)).map((n) => `${c.at}: ${c.page} has no rule ${n}`));
    expect(bad).toEqual([]);
  });
  it("every rule page numbers its rules once (no duplicate number)", () => {
    const dup: string[] = [];
    for (const page of pageNames) {
      const text = readFileSync(path.join(rulesDir, `${page}.md`), "utf8");
      const seen = new Set<string>();
      for (const m of (page === "README" ? text.slice(text.indexOf("## Standing rules")) : text).matchAll(/^(\d+[a-z]?)\. /gm)) {
        if (seen.has(m[1]!)) dup.push(`${page}: ${m[1]}`);
        seen.add(m[1]!);
      }
    }
    expect(dup).toEqual([]);
  });
  it("structure-and-naming.md states the caps that eslint enforces (one definition: lint-limits.mjs)", () => {
    const page = readFileSync(path.join(rulesDir, "structure-and-naming.md"), "utf8");
    expect(page).toContain(`at most ${FILE_LINE_CAP} lines`);
    expect(page).toContain(`at most ${FUNCTION_LINE_CAP} lines`);
    expect(existsSync(path.join(admin, "lint-limits.mjs"))).toBe(true);
  });
});
