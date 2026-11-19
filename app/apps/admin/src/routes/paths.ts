import { DEFAULT_DRAFT_VIEW, formatQuery, unlessDefault, type DraftView, type RunFilter } from "./search";
import type { SectionId } from "./sections";
import { listRouteOf, PROJECTLESS, ROUTE_TABLE, type RouteId } from "./table";
import { route } from "./typed";

export type { RouteId };

/** A destination: which route, its path without a project, and the search it carries. Where the project goes is the `Place`'s. */
export type Dest = { readonly route: RouteId; readonly path: string; readonly search: Readonly<Record<string, string>> };

/**
 * Where an address is: the project and whether the instance has two or more. One project: no project in any address
 * (`/drafts/42`). Two or more: the project is the first path segment of a scoped route (`/lisbon/drafts/42`), never a query.
 */
export type Place = { readonly project: string | null; readonly multi: boolean };

function dest(route: RouteId, path: string, query: Readonly<Record<string, string | number | boolean | null | undefined>> = {}): Dest {
  const search: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(formatQuery(query))) search[k] = v;
  return { route, path, search };
}

type DraftsArgs = { filter?: DraftView; q?: string; batch?: number | null };

/**
 * The ONLY producers of a destination. A component never writes a path; a wrong name or value fails `tsc`. The path half
 * goes through `route()`, so `typedRoutes` checks it against the file tree: a page that does not exist fails the build.
 */
export const paths = {
  overview: () => dest("overview.page", route("/overview")),
  connections: { page: () => dest("connections.page", route("/connections")) },
  drafts: {
    list: (s: DraftsArgs = {}) => dest("drafts.list", route("/drafts"), { filter: unlessDefault(s.filter, DEFAULT_DRAFT_VIEW), q: s.q, batch: s.batch }),
    item: (id: number, s: DraftsArgs = {}) => dest("drafts.item", route(`/drafts/${id}`), { filter: unlessDefault(s.filter, DEFAULT_DRAFT_VIEW), q: s.q, batch: s.batch }),
  },
  log: {
    list: (s: { filter?: RunFilter; run?: number | null } = {}) => dest("log.list", route("/log"), { filter: unlessDefault(s.filter, "all"), run: s.run }),
  },
  project: {
    page: () => dest("project.page", route("/project")),
  },
  /**
   * `/health` (P68: the core version line links there). It has no row in `ROUTE_TABLE` on purpose: it sits outside the shell and
   * names no project, so it is a plain `Route` rendered with `@hub/ui/link` (a full page load), not a `Dest` for `AppLink`.
   */
  health: () => route("/health"),
};

/** The list destination of a section (the nav item, the chord, the project switch). */
export function sectionList(id: SectionId): Dest {
  const r = listRouteOf(id);
  return dest(r, ROUTE_TABLE[r].path);
}

/** The address text of a destination: `/drafts/42?filter=hold` with one project, `/lisbon/drafts/42?filter=hold` with several. */
export function formatDest(d: Dest, place: Place): string {
  const prefix = place.multi && place.project && !PROJECTLESS.has(d.route) ? `/${encodeURIComponent(place.project)}` : "";
  return `${prefix}${d.path}${formatQuery(d.search)}`;
}
