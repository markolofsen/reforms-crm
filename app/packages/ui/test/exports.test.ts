import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Rules: architecture-and-ownership 15 (exact public subpaths, no barrel, no wildcard); P121 T3.
const root = join(import.meta.dirname, "..");
const { exports } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { exports: Record<string, string> };

describe("@hub/ui exports exact subpaths", () => {
  it("has no wildcard subpath", () => {
    expect(Object.keys(exports).filter((k) => k.includes("*"))).toEqual([]);
  });
  it("points every subpath at a file that exists", () => {
    expect(Object.entries(exports).filter(([, v]) => !existsSync(join(root, v)))).toEqual([]);
  });
  it("exports every coss copy at its own name", () => {
    const missing = readdirSync(join(root, "src/ui")).filter((f) => exports[`./${f.replace(/\.tsx$/, "")}`] !== `./src/ui/${f}`);
    expect(missing).toEqual([]);
  });
  it("keeps src/product grouped: at most 8 source files per folder", () => {
    const over = (d: string): string[] => {
      const entries = readdirSync(d, { withFileTypes: true });
      return [...(entries.filter((e) => e.isFile()).length > 8 ? [d.slice(root.length + 1)] : []), ...entries.filter((e) => e.isDirectory()).flatMap((e) => over(join(d, e.name)))];
    };
    expect(over(join(root, "src/product"))).toEqual([]);
  });
});
