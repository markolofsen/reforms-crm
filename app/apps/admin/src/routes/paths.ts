import { formatQuery, searchEntries } from "./search";
import type { SectionId } from "./sections";
import { listRouteOf, PROJECTLESS, ROUTE_TABLE, type ParamsOf, type RouteId, type RowOf, type SearchFor } from "./table";

export type { RouteId };

/** A destination: which route, its path without a project, and the search it carries. Where the project goes is the `Place`'s. */
export type Dest = { readonly route: RouteId; readonly path: string; readonly search: Readonly<Record<string, string>> };

/**
 * Where an address is: the project and whether the instance has two or more. One project: no project in any address
 * (`/mail/c/42`). Two or more: the project is the first path segment of a scoped route (`/lisbon/mail/c/42`), never a query.
 */
export type Place = { readonly project: string | null; readonly multi: boolean };

/** A route with `[name]` segments takes its params first; every route then takes the part of its search to set. */
type DestArgs<K extends RouteId> = RowOf<K> extends { params: object } ? [params: ParamsOf<K>, search?: Partial<SearchFor<K>>] : [search?: Partial<SearchFor<K>>];

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The destination of a route from values that are already typed (a resolved route, `dest`): the pattern filled with the params,
 * the search in the row's key order with every default left out. The pattern itself is checked against the file tree by the
 * row (`defineRoute`), so a filled one is a page.
 */
export function destFrom(id: RouteId, params: Readonly<Record<string, unknown>>, search: Readonly<Record<string, unknown>>): Dest {
  const row = ROUTE_TABLE[id];
  const path = row.path.replace(/\[([^\]]+)\]/g, (_m: string, name: string) => encodeURIComponent(String(params[name] ?? "")));
  const out: Record<string, string> = {};
  if ("search" in row) for (const [k, v] of new URLSearchParams(formatQuery(searchEntries(row.search, search)))) out[k] = v;
  return { route: id, path, search: out };
}

/**
 * The ONLY producer of a destination (P127 A1: one builder over the route table, in place of a builder per route). A component
 * never writes a path: `dest("mail.conversation", { key: clientKey(c) }, { filter: "all" })`; a wrong route, param or search value fails `tsc`
 * (`test/paths.types.tsx`), and a default value leaves the address.
 */
export function dest<K extends RouteId>(id: K, ...args: DestArgs<K>): Dest;
export function dest(id: RouteId, ...args: readonly unknown[]): Dest {
  const takesParams = "params" in ROUTE_TABLE[id];
  const params = takesParams ? args[0] : undefined;
  const search = takesParams ? args[1] : args[0];
  return destFrom(id, isRecord(params) ? params : {}, isRecord(search) ? search : {});
}

/** The list destination of a section (the nav item, the chord, the project switch). */
export function sectionList(id: SectionId): Dest {
  return destFrom(listRouteOf(id), {}, {});
}

/** The address text of a destination: `/mail/c/42?filter=all` with one project, `/lisbon/mail/c/42?filter=all` with several. */
export function formatDest(d: Dest, place: Place): string {
  const prefix = place.multi && place.project && !PROJECTLESS.has(d.route) ? `/${encodeURIComponent(place.project)}` : "";
  return `${prefix}${d.path}${formatQuery(d.search)}`;
}
