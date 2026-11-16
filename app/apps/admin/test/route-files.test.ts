import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_SCOPED } from "../src/routes/guards";
import { paths, sectionList } from "../src/routes/paths";
import { ROUTE_META } from "../src/routes/meta";
import { SECTIONS } from "../src/routes/sections";
import { routeOf } from "../src/routes/typed";

// The file tree decides which pages exist; `paths.ts`, `ROUTE_META` and `routeOf` describe them. This is the one place
// that fails when a page is added or removed in one and not in the others.
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
const ours = ["/overview", "/drafts", "/drafts/[id]", "/bulk", "/bulk/[id]", "/log", "/project"];

describe("the file tree and the typed layer", () => {
  it("every route id of the layer has a page file, and every page file but `/`, `/health` and the API is a route id", () => {
    const routes = [paths.overview(), paths.drafts.list(), paths.drafts.item(1), paths.bulk.list(), paths.bulk.item(1), paths.log.list(), paths.project.page()];
    expect(routes.map((d) => d.route).sort()).toEqual(Object.keys(ROUTE_META).sort());
    for (const p of ours) expect(tree, p).toContain(p);
    expect(tree.filter((p) => !ours.includes(p))).toEqual(["/", "/health"]);
  });

  it("each section list path is a page file", () => {
    for (const s of SECTIONS) expect(tree).toContain(sectionList(s.id).path);
  });

  it("the run-time door accepts the pages and the guard pattern agrees with it", () => {
    for (const ok of ["/", "/overview", "/overview?focus=a", "/drafts", "/drafts?project=x", "/drafts/42?project=x&filter=hold", "/bulk/3", "/log?run=2", "/project?project=x"]) expect(routeOf(ok), ok).toBe(ok);
    for (const bad of ["/nope", "/drafts/abc", "/drafts/0", "/drafts/1/2", "//evil.test", "/api/pulse", "https://evil.test/drafts"]) expect(routeOf(bad), bad).toBeNull();
    expect(["/drafts", "/drafts/9", "/bulk", "/bulk/9", "/log", "/project"].every((p) => PROJECT_SCOPED.test(p))).toBe(true);
    expect(["/", "/overview", "/health", "/drafts/x"].some((p) => PROJECT_SCOPED.test(p))).toBe(false);
  });
});
