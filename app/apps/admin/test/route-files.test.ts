import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routeOf } from "../src/routes/typed";
import { sectionList } from "../src/routes/paths";
import { SECTIONS } from "../src/routes/sections";
import { PROJECTLESS, ROUTE_TABLE } from "../src/routes/table";

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
const rows = Object.values(ROUTE_TABLE);
// P127 A2 (owner remark 2026-11-23): ONE route tree. A scoped row's page is only under `[project]`; a projectless row's page is
// only at the top. A bare scoped address (`/mail`) is served by the rewrite in `src/proxy.ts` to `/_/mail`, not by a twin page.
const pageOf = (r: (typeof rows)[number]): string => (r.scoped ? `/[project]${r.path}` : r.path);
const rowPaths = rows.map(pageOf);

describe("the file tree and the route table", () => {
  it("every row has exactly one page file, and every page file but `/`, `/health` and the API has a row", () => {
    for (const p of rowPaths) expect(tree, p).toContain(p);
    expect(tree.filter((p) => !rowPaths.includes(p))).toEqual(["/", "/health"]);
  });

  it("no twins: a scoped row has no page at the top, a projectless row none under `[project]`", () => {
    for (const r of rows) expect(tree, r.path).not.toContain(r.scoped ? r.path : `/[project]${r.path}`);
  });

  it("the sections of the table are the sections of SECTIONS, and each list route has its page file", () => {
    expect([...new Set(rows.map((r) => r.section))].sort()).toEqual(SECTIONS.map((s) => s.id).sort());
    for (const s of SECTIONS) {
      const list = sectionList(s.id);
      expect(tree).toContain(ROUTE_TABLE[list.route].scoped ? `/[project]${list.path}` : list.path);
    }
  });

  it("the patterns derived from the table accept the addresses (a scoped one with or without its project) and nothing else", () => {
    for (const ok of ["/", "/overview", "/mail", "/mail?filter=hold", "/mail/c/42?filter=all&batch=3", "/messengers/c/7?filter=linked&channel=whatsapp", "/log?client=2", "/knowledge", "/settings", "/settings/mail", "/settings/agent", "/settings/connections", "/settings/mac", "/help", "/lisbon/mail", "/lisbon/mail/c/42?filter=waiting", "/lisbon/messengers/c/7", "/demo%20shop/log", "/lisbon/knowledge", "/lisbon/settings", "/lisbon/settings/agent"]) expect(routeOf(ok), ok).toBe(ok);
    // A project before an instance pane is Not found (P127 A2: no fold page), like one before Overview or Help.
    for (const bad of ["/bulk", "/bulk/3", "/nope", "/mail/abc", "/mail/0", "/mail/1/2", "/mail/42", "/mail/in/7", "//evil.test", "/api/pulse", "https://evil.test/mail", "/lisbon/overview", "/lisbon/help", "/lisbon", "/a/b/mail", "/settings/nope", "/project", "/agents", "/connections", "/lisbon/settings/connections", "/lisbon/settings/mac", "/_/mail"]) expect(routeOf(bad), bad).toBeNull();
    expect([...PROJECTLESS].sort()).toEqual(["help.page", "overview.page", "settings.connections", "settings.mac"]);
  });
});
