import { DEFAULT_DRAFT_VIEW, formatQuery, unlessDefault, type DraftView, type KnowledgeView, type ActivityView } from "./search";
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
  help: { page: () => dest("help.page", route("/help")) },
  knowledge: { page: (s: { filter?: KnowledgeView; q?: string } = {}) => dest("knowledge.page", route("/knowledge"), { filter: unlessDefault(s.filter, "all"), q: s.q }) },
  /** P70: one Settings, grouped by what each pane governs; `/settings` is Sending. Connections and This Mac name no project. */
  settings: {
    sending: () => dest("settings.page", route("/settings")),
    mail: () => dest("settings.mail", route("/settings/mail")),
    agent: () => dest("settings.agent", route("/settings/agent")),
    connections: () => dest("settings.connections", route("/settings/connections")),
    mac: () => dest("settings.mac", route("/settings/mac")),
  },
  drafts: {
    list: (s: DraftsArgs = {}) => dest("drafts.list", route("/drafts"), { filter: unlessDefault(s.filter, DEFAULT_DRAFT_VIEW), q: s.q, batch: s.batch }),
    item: (id: number, s: DraftsArgs = {}) => dest("drafts.item", route(`/drafts/${id}`), { filter: unlessDefault(s.filter, DEFAULT_DRAFT_VIEW), q: s.q, batch: s.batch }),
  },
  log: {
    list: (s: { filter?: ActivityView; run?: number | null } = {}) => dest("log.list", route("/log"), { filter: unlessDefault(s.filter, "all"), run: s.run }),
  },
};

/** The list destination of a section (the nav item, the chord, the project switch). */
export function sectionList(id: SectionId): Dest {
  const r = listRouteOf(id);
  return dest(r, ROUTE_TABLE[r].path);
}

/** The bare destination of a route with no parameter (a nav item, a child page of the sub-nav, the page a dot names). */
export function routeDest(id: Exclude<RouteId, "drafts.item">): Dest {
  return dest(id, ROUTE_TABLE[id].path);
}

/** The address text of a destination: `/drafts/42?filter=hold` with one project, `/lisbon/drafts/42?filter=hold` with several. */
export function formatDest(d: Dest, place: Place): string {
  const prefix = place.multi && place.project && !PROJECTLESS.has(d.route) ? `/${encodeURIComponent(place.project)}` : "";
  return `${prefix}${d.path}${formatQuery(d.search)}`;
}
