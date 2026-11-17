import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CORE_ROOT } from "@hub/config/paths";

// Gate (P45): ONE import style in every package and app: a relative import has no file extension (`./steps/files`, not `./steps/files.ts` or `.js`),
// the style the server, db, messengers and the admin's bundler already used. Code moves between packages without a rewrite, and tsc
// (no `allowImportingTsExtensions`) refuses a `.ts` import on its own; a `.js` import of a TypeScript file only this test catches.
// Entry files that are plain JavaScript (`*.mjs`) are not TypeScript and keep the extension Node needs: this test reads `.ts`, `.tsx` and `.mts` only.
const ROOTS = ["apps", "packages"].map((d) => path.join(CORE_ROOT, "app", d));
const THIS = fileURLToPath(import.meta.url);
const SKIP = new Set(["node_modules", ".next", ".turbo", "dist", "coverage", "playwright-report"]);
const RELATIVE_WITH_EXTENSION = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bmock\(\s*|\bimportActual\(\s*|\bimportOriginal\(\s*)(["'])(\.{1,2}\/[^"']*?\.(?:ts|tsx|js))\2/g;

function* sources(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) yield* sources(f);
    else if (/\.(ts|tsx|mts)$/.test(e.name) && !e.name.endsWith(".d.ts") && f !== THIS) yield f; // this file quotes the bad shapes on purpose
  }
}

describe("import style", () => {
  it("no relative import in any package or app names a .ts, .tsx or .js extension", () => {
    const bad: string[] = [];
    let scanned = 0;
    for (const root of ROOTS) for (const f of sources(root)) {
      scanned++;
      for (const m of readFileSync(f, "utf8").matchAll(RELATIVE_WITH_EXTENSION)) bad.push(`${path.relative(CORE_ROOT, f)}: ${m[3]}`);
    }
    expect(scanned).toBeGreaterThan(300);
    expect(bad).toEqual([]);
  });
  it("the pattern does catch each shape it is meant to", () => {
    for (const s of [`import x from "./a.ts"`, `export * from '../b.js'`, `await import("./c.tsx")`, `vi.mock("../src/d.ts"`, `import "./e.js"`]) {
      expect([...s.matchAll(RELATIVE_WITH_EXTENSION)].length, s).toBe(1);
    }
    for (const s of [`import x from "./a"`, `import css from "./x.css"`, `import p from "pkg/x.js"`, `import j from "./data.json"`]) {
      expect([...s.matchAll(RELATIVE_WITH_EXTENSION)].length, s).toBe(0);
    }
  });
});
