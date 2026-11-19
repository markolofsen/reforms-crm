import type { Route } from "next";

// `/drafts/[id]` read as the number it matches, so `Route<...>` (the union of the pages in `src/app`, plus a string that fits a
// dynamic page) can judge it; a path that is not a page makes the parameter `never` and `tsc` refuses the row (decision 0021).
type Fill<P extends string> = P extends `${infer A}[${string}]${infer B}` ? `${A}${number}${Fill<B>}` : P;
type Checked<P extends string> = Fill<P> extends Route<Fill<P>> ? P : never;

/**
 * What the shell reads of a page in the nav (P63 N1). A parent row (no `parent`) is a section: it has its `g` chord and its place
 * on the phone, the tab bar or the More menu. A child row names its parent's route: it is drawn under the parent in the open
 * sidebar while the parent is active, and in the sub-nav of the parent's pages on every width; never on the rail or the phone bar.
 * Every row is on every instance: with Overview everywhere no row is for several projects only.
 */
export type NavMeta = {
  readonly label: string;
  readonly icon: string;
  readonly order: number;
  /** Parents: required (the check below). Children: none in v1. */
  readonly chord?: string;
  readonly parent?: string;
  /** Parents: the phone tab bar or its More menu. */
  readonly phone?: "bar" | "more";
};
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
  "overview.page": defineRoute("/overview", { section: "overview", scoped: false, title: "Overview", nav: { label: "Overview", icon: "overview", order: 0, chord: "o", phone: "bar" } }),
  "drafts.list": defineRoute("/drafts", { section: "drafts", scoped: true, title: "Drafts", nav: { label: "Drafts", icon: "inbox", order: 1, chord: "d", phone: "bar" } }),
  "drafts.item": defineRoute("/drafts/[id]", { section: "drafts", scoped: true, title: "Drafts", crumb: "Draft" }),
  "log.list": defineRoute("/log", { section: "log", scoped: true, title: "Activity", nav: { label: "Activity", icon: "activity", order: 2, chord: "a", phone: "bar" } }),
  "project.page": defineRoute("/project", { section: "project", scoped: true, title: "Project", nav: { label: "Project", icon: "settings", order: 3, chord: "p", phone: "bar" } }),
  "project.knowledge": defineRoute("/project/knowledge", { section: "project", scoped: true, title: "Knowledge", nav: { label: "Knowledge", icon: "knowledge", order: 1, parent: "project.page" } }),
  "project.setup": defineRoute("/project/setup", { section: "project", scoped: true, title: "Setup", nav: { label: "Setup", icon: "setup", order: 2, parent: "project.page" } }),
  "agents.page": defineRoute("/agents", { section: "agents", scoped: true, title: "Agents", nav: { label: "Agents", icon: "agents", order: 4, chord: "t", phone: "more" } }),
  "connections.page": defineRoute("/connections", { section: "connections", scoped: false, title: "Connections", nav: { label: "Connections", icon: "connections", order: 5, chord: "c", phone: "more" } }),
  "help.page": defineRoute("/help", { section: "help", scoped: false, title: "Help", nav: { label: "Help", icon: "help", order: 6, chord: "h", phone: "more" } }),
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
  "project.knowledge": true,
  "project.setup": true,
  "agents.page": true,
  "connections.page": true,
  "help.page": true,
};

// A nav row is a parent (a chord and a phone place, no `parent`) or a child (a `parent` that is a parent row of the same scope,
// no chord, no phone place); anything else makes the property `never`, and `true` fails `tsc`.
type Parent<R> = R extends { nav: { parent: string } } ? never : R extends { nav: { chord: string; phone: string } } ? R : never;
export type NavCheck<R> = R extends { nav: infer N }
  ? N extends { parent: infer P }
    ? P extends RouteId
      ? [Parent<(typeof ROUTE_TABLE)[P]>] extends [never]
        ? never
        : N extends { chord: string } | { phone: string }
          ? never
          : R extends { scoped: (typeof ROUTE_TABLE)[P]["scoped"] }
            ? true
            : never
      : never
    : [Parent<R>] extends [never] ? never : true
  : true;
export const NAV_SHAPE: { readonly [K in RouteId]: NavCheck<(typeof ROUTE_TABLE)[K]> } = {
  "overview.page": true,
  "drafts.list": true,
  "drafts.item": true,
  "log.list": true,
  "project.page": true,
  "project.knowledge": true,
  "project.setup": true,
  "agents.page": true,
  "connections.page": true,
  "help.page": true,
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

/** The list route of a section: its parent row (with `nav` and no `parent`). */
export function listRouteOf(section: string): RouteId {
  const id = ROUTE_IDS.find((k) => {
    const r: Row = ROUTE_TABLE[k];
    return r.section === section && "nav" in r && !("parent" in r.nav);
  });
  if (!id) throw new Error(`no route for section ${section}`);
  return id;
}
