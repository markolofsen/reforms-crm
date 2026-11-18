import type { Route } from "next";

// `/drafts/[id]` read as the number it matches, so `Route<...>` (the union of the pages in `src/app`, plus a string that fits a
// dynamic page) can judge it; a path that is not a page makes the parameter `never` and `tsc` refuses the row (decision 0021).
type Fill<P extends string> = P extends `${infer A}[${string}]${infer B}` ? `${A}${number}${Fill<B>}` : P;
type Checked<P extends string> = Fill<P> extends Route<Fill<P>> ? P : never;

/** What the shell reads of a section: its nav entry. `when: "multi"` shows it only with two or more projects (Overview). */
export type NavMeta = { readonly label: string; readonly icon: string; readonly order: number; readonly chord: string; readonly when: "always" | "multi" };
export type RouteMeta = {
  readonly section: string;
  /** True: the address names a project when the instance has two or more (`/<project>/drafts`), never a query. */
  readonly scoped: boolean;
  readonly title: string;
  /** The breadcrumb word of an item route (`Draft 42`). */
  readonly crumb?: string;
  /** Only on a section's list route. */
  readonly nav?: NavMeta;
};

/**
 * One row of the route table: the file-tree pattern (checked against `src/app` by `typedRoutes`) and the metadata the shell,
 * the titles and the guard read. The same idea as `defineRoute` of `@djangocfg/nextjs/navigation` (the carapis catalogue
 * routes), written here in a few lines: that package also ships sitemap, health, OG and config server utilities with their
 * own dependencies (chalk, conf, consola, semver) and its metadata has no project placement and no typed-route check, so
 * importing it would add weight for an identity function (`architecture-and-ownership.md` rule 14).
 */
export function defineRoute<const P extends string, const M extends RouteMeta>(path: Checked<P>, meta: M) {
  return { path, ...meta } as const;
}

/**
 * The one declaration of which pages exist (decision 0021). Every internal address is built from it (`paths.ts`), the nav and
 * the chords derive from its `nav` metadata (`sections.ts`), and nothing concatenates a path at a call site. A scoped row has a
 * twin page under `src/app/(shell)/[project]/` (checked below and by `test/route-files.test.ts`). No imports but a type.
 */
export const ROUTE_TABLE = {
  "overview.page": defineRoute("/overview", { section: "overview", scoped: false, title: "Overview", nav: { label: "Overview", icon: "overview", order: 0, chord: "o", when: "multi" } }),
  "drafts.list": defineRoute("/drafts", { section: "drafts", scoped: true, title: "Drafts", nav: { label: "Drafts", icon: "inbox", order: 1, chord: "d", when: "always" } }),
  "drafts.item": defineRoute("/drafts/[id]", { section: "drafts", scoped: true, title: "Drafts", crumb: "Draft" }),
  "log.list": defineRoute("/log", { section: "log", scoped: true, title: "Activity", nav: { label: "Activity", icon: "activity", order: 2, chord: "a", when: "always" } }),
  "project.page": defineRoute("/project", { section: "project", scoped: true, title: "Project", nav: { label: "Project", icon: "settings", order: 3, chord: "p", when: "always" } }),
  "connections.page": defineRoute("/connections", { section: "connections", scoped: false, title: "Connections", nav: { label: "Connections", icon: "connections", order: 4, chord: "c", when: "always" } }),
} as const;

export type RouteId = keyof typeof ROUTE_TABLE;
type Row = (typeof ROUTE_TABLE)[RouteId];

// A scoped row without its `[project]` twin page makes the property `never`, and `true` fails `tsc`.
type Twin<R> = R extends { path: infer P extends string; scoped: true } ? Checked<`/[project]${P}`> : string;
export const TWINS: { readonly [K in RouteId]: [Twin<(typeof ROUTE_TABLE)[K]>] extends [never] ? never : true } = {
  "overview.page": true,
  "drafts.list": true,
  "drafts.item": true,
  "log.list": true,
  "project.page": true,
  "connections.page": true,
};

const ID = String.raw`[1-9]\d*`;
/** One project segment of a multi-project address: anything but a slash, a query or a fragment (the slug is URL-encoded). */
const SLUG = String.raw`[^/?#]+`;
const escape = (p: string): string => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\[id\\]", () => ID);

const isRouteId = (k: string): k is RouteId => k in ROUTE_TABLE;
export const ROUTE_IDS: readonly RouteId[] = Object.keys(ROUTE_TABLE).filter(isRouteId);
const rows: readonly Row[] = Object.values(ROUTE_TABLE);
const pattern = (r: Row): string => (r.scoped ? `(?:/${SLUG})?${escape(r.path)}` : escape(r.path));

/** Every page of the tree (both shapes of a scoped one) and the entry `/`, with an optional query: the run-time door `routeOf` accepts exactly these. */
export const PAGE = new RegExp(`^(/|${rows.map(pattern).join("|")})(\\?[^#]*)?$`);

/** The routes about the whole instance: their address never names a project. */
export const PROJECTLESS: ReadonlySet<RouteId> = new Set(ROUTE_IDS.filter((id) => !ROUTE_TABLE[id].scoped));

/** The first path segments that are sections, not projects: a project with one of these names cannot be addressed by path. */
export const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([...rows.map((r) => r.path.split("/")[1] ?? ""), "health", "api"]);

/** The list route of a section: its row with `nav`. */
export function listRouteOf(section: string): RouteId {
  const id = ROUTE_IDS.find((k) => ROUTE_TABLE[k].section === section && "nav" in ROUTE_TABLE[k]);
  if (!id) throw new Error(`no route for section ${section}`);
  return id;
}
