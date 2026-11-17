import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routeOf } from "../src/routes/typed";
import { sectionList } from "../src/routes/paths";
import { SECTIONS } from "../src/routes/sections";
import { PROJECT_SCOPED, PROJECTLESS, ROUTE_TABLE } from "../src/routes/table";

// `routes/table.ts` declares the pages and `typedRoutes` checks each row against the tree, but it cannot see a page file
// that has no row (that page would render and be unreachable by `routeOf` and the proxy). This is the one place that does.
const APP = join(import.meta.dirname, "../src/app");

function pages(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...pages(join(dir, e.name), e.name.startsWith("(") ? prefix : `${prefix}/${e.name}`));
    else if (e.name === "page.tsx") out.push(prefix === "" ? "/" : prefix);
  }
  return out.sort();
}

const tree = pages(APP);
const rowPaths = Object.values(ROUTE_TABLE).map((r) => r.path as string);

describe("the file tree and the route table", () => {
  it("every row has a page file, and every page file but `/`, `/health` and the API has a row", () => {
    for (const p of rowPaths) expect(tree, p).toContain(p);
    expect(tree.filter((p) => !rowPaths.includes(p))).toEqual(["/", "/health"]);
  });

  it("the sections of the table are the sections of SECTIONS, and each list path is a page file", () => {
    expect([...new Set(Object.values(ROUTE_TABLE).map((r) => r.section))].sort()).toEqual(SECTIONS.map((s) => s.id).sort());
    for (const s of SECTIONS) expect(tree).toContain(sectionList(s.id).path);
  });

  it("the patterns derived from the table accept the pages and nothing else", () => {
    for (const ok of ["/", "/overview", "/overview?focus=a", "/connections", "/drafts", "/drafts?project=x", "/drafts/42?project=x&filter=hold&batch=3", "/log?run=2", "/project?project=x"]) expect(routeOf(ok), ok).toBe(ok);
    for (const bad of ["/bulk", "/bulk/3", "/nope", "/drafts/abc", "/drafts/0", "/drafts/1/2", "//evil.test", "/api/pulse", "https://evil.test/drafts"]) expect(routeOf(bad), bad).toBeNull();
    expect(["/drafts", "/drafts/9", "/log", "/project"].every((p) => PROJECT_SCOPED.test(p))).toBe(true);
    expect(["/", "/overview", "/connections", "/health", "/drafts/x"].some((p) => PROJECT_SCOPED.test(p))).toBe(false);
    expect([...PROJECTLESS].sort()).toEqual(["connections.page", "overview.page"]);
  });
});
