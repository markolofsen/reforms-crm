import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The package's own gates (rules: architecture-and-ownership 2, design-system-and-tokens 11 and 13). It reads files, it renders nothing.
const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "src");
const read = (p: string) => readFileSync(path.join(src, p), "utf8");
function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}
const files = [...walk(src)].filter((p) => /\.(tsx?|css)$/.test(p));

describe("@hub/ui direction rule", () => {
  it("depends on no other @hub package (a dev dependency on @hub/config is for the tsconfig and lint caps only)", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { dependencies?: object; peerDependencies?: object };
    const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})];
    expect(names.filter((n) => n.startsWith("@hub/"))).toEqual([]);
  });

  it("no file imports an app, a @hub package, `@/` or Next, and none holds a Server Action or a public env var", () => {
    const bad = files.filter((p) => {
      const text = readFileSync(p, "utf8");
      return /from "(@hub\/|@\/|next\/|next")/.test(text) || text.includes('"use server"') || text.includes("NEXT_PUBLIC_");
    });
    expect(bad.map((p) => path.relative(src, p))).toEqual([]);
  });

  it("every export key points at a file that exists", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { exports: Record<string, string> };
    for (const target of Object.values(pkg.exports)) {
      const dir = path.dirname(path.join(root, target));
      expect(statSync(dir).isDirectory(), target).toBe(true);
    }
  });

  it("keeps the terminal speech preference behind one storage seam", () => {
    const users = files.filter((p) => readFileSync(p, "utf8").includes("window.localStorage")).map((p) => path.relative(src, p));
    expect(users).toEqual(["product/terminal/storage.ts"]);
  });
});

describe("@hub/ui tokens", () => {
  it("styles.css carries the three control heights in both values and scans its own classes", () => {
    const css = read("styles.css");
    for (const t of ["s: 2rem", "m: 2.5rem", "l: 3rem"]) expect(css).toContain(`--control-${t}`);
    for (const t of ["s: 2.75rem", "m: 2.75rem"]) expect(css).toContain(`--control-${t}`);
    expect(css).toContain('@source "./";');
    expect(css).not.toMatch(/@import\s+["']tailwindcss/);
  });

  it("styles.css carries every terminal token in the light set and the dark set, as complete colours (P49)", () => {
    const css = read("styles.css");
    const sets = [...css.matchAll(/(?:^|\n)(:root|\.dark) \{([^}]*--terminal-bg[^}]*)\}/g)];
    expect(sets.map((m) => m[1])).toEqual([":root", ".dark"]);
    const names = (body: string) => [...body.matchAll(/(--terminal-[a-z-]+):\s*(#[0-9a-f]{6}(?:[0-9a-f]{2})?);/g)].map((m) => m[1]);
    const [light, dark] = sets.map((m) => names(m[2] ?? ""));
    expect(light).toHaveLength(20);
    expect(dark).toEqual(light);
  });

  it("styles.css keeps the product breakpoints explicit", () => {
    expect(read("styles.css")).toContain("--breakpoint-md: 40rem");
    expect(read("styles.css")).toContain("--container-3xl: 48rem");
    expect(read("use-media-query.ts")).toMatch(/md:\s*640\b/);
    expect(read("product/list-detail.tsx")).toContain("SPLIT_MIN_PX = 768");
  });
});
