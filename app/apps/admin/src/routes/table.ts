import type { Route } from "next";

// `/drafts/[id]` read as the number it matches, so `Route<...>` (the union of the pages in `src/app`, plus a string that fits a
// dynamic page) can judge it; a path that is not a page makes the parameter `never` and `tsc` refuses the row (decision 0021).
type Fill<P extends string> = P extends `${infer A}[${string}]${infer B}` ? `${A}${number}${Fill<B>}` : P;
type Checked<P extends string> = Fill<P> extends Route<Fill<P>> ? P : never;

function row<const P extends string, const S extends string>(path: Checked<P>, section: S, scoped: boolean) {
  return { path, section, scoped } as const;
}

/**
 * The one declaration of which pages exist. A row is the file-tree pattern (checked against `src/app` by `typedRoutes`), its
 * section, and whether its address must name a project (`routes-and-url-state.md` rule 10: Overview and Connections do not).
 * The first row of a section is its list page. `PAGE`, `PROJECT_SCOPED`, `PROJECTLESS` and `RouteId` derive from it; no file
 * keeps a second copy. No imports but a type: the proxy and the tests read it.
 */
export const ROUTE_TABLE = {
  "overview.page": row("/overview", "overview", false),
  "connections.page": row("/connections", "connections", false),
  "drafts.list": row("/drafts", "drafts", true),
  "drafts.item": row("/drafts/[id]", "drafts", true),
  "log.list": row("/log", "log", true),
  "project.page": row("/project", "project", true),
} as const;

export type RouteId = keyof typeof ROUTE_TABLE;

const ID = String.raw`[1-9]\d*`;
const alternation = (paths: readonly string[]): string =>
  paths.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\[id\\]", () => ID)).join("|");

const isRouteId = (k: string): k is RouteId => k in ROUTE_TABLE;
const ids: readonly RouteId[] = Object.keys(ROUTE_TABLE).filter(isRouteId);
const rows: readonly { path: string; section: string; scoped: boolean }[] = Object.values(ROUTE_TABLE);

/** Every page of the tree and the entry `/`, with an optional query: the run-time door `routeOf` accepts exactly these. */
export const PAGE = new RegExp(`^(/|${alternation(rows.map((r) => r.path))})(\\?[^#]*)?$`);

/** The pathnames whose address must name a project; `proxy.ts` redirects a bare one. */
export const PROJECT_SCOPED = new RegExp(`^(${alternation(rows.filter((r) => r.scoped).map((r) => r.path))})$`);

/** The routes about the whole instance: their address names no project. */
export const PROJECTLESS: ReadonlySet<RouteId> = new Set(ids.filter((id) => !ROUTE_TABLE[id].scoped));

/** The list route of a section: its first row. */
export function listRouteOf(section: string): RouteId {
  const id = ids.find((k) => ROUTE_TABLE[k].section === section);
  if (!id) throw new Error(`no route for section ${section}`);
  return id;
}
