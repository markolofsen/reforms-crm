import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_ROOT } from "@hub/config/paths";

// Gate (decision 0016, phase S1): where the hub keeps its files is decided in ONE place, `@hub/config/paths` (`hubPaths()`).
// A new file that joins a path to the repo root itself, or reads HUB_HOME / HUB_PROJECTS / HUB_CONFIG_DIR / HUB_CONFIG_FILE itself,
// would work today and break the day the instance moves out of this checkout. The check reads source text only.
const APP = path.join(CORE_ROOT, "app");
const SRC_ROOTS = ["apps", "packages"];
const THE_ONE = "app/packages/config/src/paths.ts";
/** file -> why it may name a path or read an override itself */
const ALLOWED: Record<string, string> = {
  "app/packages/config/src/modes.ts": "reads HUB_DB only to refuse a fake on the live database (P126 K1: the switches' one reader); it resolves no path",
};

const FORBIDDEN: ReadonlyArray<readonly [name: string, re: RegExp]> = [
  ["a join onto state/secrets, state/projects or state/evidence", /["']state["']\s*,\s*["'](secrets|projects|evidence)["']/],
  ["a join onto app/projects or app/data", /["']app["']\s*,\s*["'](projects|data)["']/],
  ["a join onto config/config.json or config/mcp.json", /["']config["']\s*,\s*["'](config|mcp)\.json["']/],
  ["the instance's .mcp.json or guard.log named as a path segment", /,\s*["'](\.mcp\.json|guard\.log)["']/],
  ["a join onto .claude/skills", /["']\.claude["']\s*,\s*["']skills["']/],
  ["a join onto <root>/skills", /join\(\s*[\w.]+\s*,\s*["']skills["']/],
  ["three or more parent steps from a module (a walk up to the repo root)", /["']\.\.["']\s*,\s*["']\.\.["']\s*,\s*["']\.\.["']|["'](\.\.\/){3,}/],
  ["a read of HUB_HOME, HUB_PROJECTS, HUB_CONFIG_DIR, HUB_CONFIG_FILE or HUB_DB", /\benv(\.|\[["'])HUB_(HOME|PROJECTS|CONFIG_DIR|CONFIG_FILE|DB)\b(?!\s*=[^=])/],
  ["a call of defaultRoot() (the core checkout) for instance data", /\bdefaultRoot\(\)/],
];

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    if (["node_modules", ".next", "dist", ".turbo", "test", "tests", "testing", "e2e", "eval", "fixtures"].includes(e)) continue;
    const f = path.join(dir, e);
    if (statSync(f).isDirectory()) yield* walk(f);
    else if (/\.(ts|tsx|mjs)$/.test(e) && !/\.test\.tsx?$/.test(e)) yield f;
  }
}

const sourceFiles = (): string[] => SRC_ROOTS.flatMap((r) => readdirSync(path.join(APP, r)).flatMap((p) => {
  const src = path.join(APP, r, p, "src");
  try { return [...walk(src)]; } catch { return []; }
}));

const code = (text: string): string[] => text.split("\n").map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? "" : l));

describe("home seams: one function decides where the hub's files live", () => {
  const files = sourceFiles();
  it("scans the source of every app and package", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith("apps/installer/src/cli.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("apps/server/src/main.ts"))).toBe(true);
  });
  it("no file outside @hub/config/paths joins a root path or reads a location override itself", () => {
    const hits: string[] = [];
    for (const f of files) {
      const rel = path.relative(path.dirname(APP), f).split(path.sep).join("/");
      if (rel === THE_ONE || ALLOWED[rel]) continue;
      code(readFileSync(f, "utf8")).forEach((line, i) => {
        for (const [name, re] of FORBIDDEN) if (re.test(line)) hits.push(`${rel}:${i + 1}  ${name}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(hits, `ask hubPaths() (@hub/config/paths) instead:\n${hits.join("\n")}`).toEqual([]);
  });
  it("the patterns do catch what they are for", () => {
    const bad = [
      'path.join(root, "state", "secrets")', 'join(r, "app", "projects", s)', 'join(r, "config", "config.json")', 'join(r, ".mcp.json")',
      'join(home, ".claude", "skills")', 'join(root, "skills", n)', 'resolve(here, "..", "..", "..", "state")', 'process.env.HUB_PROJECTS ?? x', 'env.HUB_CONFIG_DIR?.trim()', "defaultRoot()",
    ];
    for (const line of bad) expect(FORBIDDEN.some(([, re]) => re.test(line)), line).toBe(true);
    for (const line of ["process.env.HUB_PROJECTS = root;", 'z.discriminatedUnion("state", [])', "hubPaths().projects"]) expect(FORBIDDEN.some(([, re]) => re.test(line)), line).toBe(false);
  });
  it("every allow-list entry still exists and still needs its exception", () => {
    for (const rel of Object.keys(ALLOWED)) {
      const text = code(readFileSync(path.join(path.dirname(APP), rel), "utf8")).join("\n");
      expect(FORBIDDEN.some(([, re]) => re.test(text)), `${rel} no longer needs an exception`).toBe(true);
    }
  });
});
