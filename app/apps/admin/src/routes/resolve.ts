import { clientKey } from "@hub/contract/client-key";
import { parseRef } from "@hub/contract/focus";
import { dest, destFrom, type Dest } from "./paths";
import { parseQuery, readSearch, type SearchSpec } from "./search";
import type { SectionId } from "./sections";
import { addressOf, RESERVED_SEGMENTS, ROUTE_IDS, ROUTE_TABLE, type ParamsOf, type RouteId, type RowOf, type SearchFor } from "./table";

/**
 * `project`: the project the address names, from its first path segment (`/lisbon/mail`). `inPath` says it came from the
 * path. `entry`: the bare `/`, decided by the guard (Mail, or Overview with two or more projects).
 */
type Base = { project: string | null; inPath: boolean; entry: boolean };
/** One route as a value: its params and search typed from its row (P127 A1: derived, never written per route). */
export type RouteOf<K extends RouteId> = Base & { route: K; section: RowOf<K>["section"]; params: ParamsOf<K>; search: SearchFor<K> };
type NotFound = Base & { route: "notFound"; section: null; path: string };
/** The address as a value. `notFound` is a real state: an unknown path or a non-numeric id never shows another screen. */
export type Resolved = { [K in RouteId]: RouteOf<K> }[RouteId] | NotFound;

/** The empty address resolves as Mail's list; the guard decides where it really opens (Mail, or Overview with several projects). */
const ENTRY: RouteId = "mail.list";

const decode = (s: string): string | null => {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
};

const segmentsOf = (id: RouteId): readonly string[] => ROUTE_TABLE[id].path.split("/").filter(Boolean);

/** The row whose pattern the segments fit (literal segments equal, `[name]` segments taken raw), or null. */
function match(segs: readonly string[]): { id: RouteId; raw: Record<string, string> } | null {
  for (const id of ROUTE_IDS) {
    const pattern = segmentsOf(id);
    if (pattern.length !== segs.length) continue;
    const raw: Record<string, string> = {};
    const fits = pattern.every((p, i) => {
      const seg = segs[i] ?? "";
      const name = /^\[(.+)\]$/.exec(p)?.[1];
      if (name === undefined) return p === seg;
      raw[name] = seg;
      return true;
    });
    if (fits) return { id, raw };
  }
  return null;
}

/** A value built by `resolveRoute` is one of the routes: its row exists, and it carries exactly its row's section, params and search keys. */
function isResolved(v: { route: RouteId; section: string; params: Readonly<Record<string, unknown>>; search: Readonly<Record<string, unknown>> } & Base): v is Exclude<Resolved, NotFound> {
  const row = ROUTE_TABLE[v.route];
  const same = (keys: readonly string[], spec: object | undefined) => keys.length === Object.keys(spec ?? {}).length && keys.every((k) => k in (spec ?? {}));
  return row.section === v.section && same(Object.keys(v.params), "params" in row ? row.params : undefined) && same(Object.keys(v.search), "search" in row ? row.search : undefined);
}

/**
 * `path` and `search` of the address into a typed route. Pure: the hooks hand it the two strings and nothing else. One generic
 * reading of the table: the row whose pattern fits, its params through the row's parsers (a refused one is Not found), its
 * search through the row's spec. The file tree decides what renders; `test/route-files.test.ts` fails when the two disagree.
 */
export function resolveRoute(path: string, searchString: string): Resolved {
  const raw = parseQuery(searchString);
  // The segment a bare scoped address is served under (P127 A2): the server may render `/_/mail` for `/mail`; both are one address.
  const all = addressOf(path).split("/").filter(Boolean);
  const inPath = all.length > 0 && !RESERVED_SEGMENTS.has(all[0] ?? "");
  // Saved links of the query-string era (`/<section>/1?project=lisbon`, until 2026-11-18, P48): the project is read here, once,
  // and the guard writes the address back in the path form (`canonicalAddress`). Delete when no saved link can still hold it.
  const legacy = raw.project ? raw.project : null;
  const project = inPath ? decode(all[0] ?? "") : legacy;
  const segs = inPath ? all.slice(1) : all;
  const base: Base = { project, inPath, entry: all.length === 0 };
  const notFound: NotFound = { ...base, route: "notFound", section: null, path };
  // A project segment heads a scoped section only; `/lisbon` and an undecodable slug are Not found.
  if (inPath && (project === null || segs.length === 0)) return notFound;
  const found = segs.length === 0 ? { id: ENTRY, raw: {} } : match(segs);
  if (!found) return notFound;
  const row = ROUTE_TABLE[found.id];
  // `/lisbon/overview`, `/lisbon/settings/connections`: a project before a projectless route (its page exists once, at the top).
  if (inPath && !row.scoped) return notFound;
  const params: Record<string, unknown> = {};
  if ("params" in row) {
    for (const [name, parse] of Object.entries(row.params)) {
      const v = parse(found.raw[name] ?? "");
      if (v === null) return notFound;
      params[name] = v;
    }
  }
  const value = { ...base, route: found.id, section: row.section, params, search: "search" in row ? readSearch(row.search, raw) : {} };
  return isResolved(value) ? value : notFound;
}

/** A route back into the destination that addresses it (the canonical form). Null for not-found. */
export function destOf(r: Resolved): Dest | null {
  return r.route === "notFound" ? null : destFrom(r.route, r.params, r.search);
}

/**
 * The destination that sets search keys on the current route and keeps the rest; each value is read through the row's spec,
 * so one outside its enum resets to the default. Null when the route has no such key. Two behaviours are more than "set a
 * key", and stay explicit here (and in `test/search-state.test.ts`): a view change on a lead returns to Mail's list, whose
 * first row then opens; Activity's Sends view (the send history) drops `?client=`.
 */
export function searchDest(r: Resolved, patch: Readonly<Record<string, string | number | null>>): Dest | null {
  if (r.route === "notFound") return null;
  const row = ROUTE_TABLE[r.route];
  if (!("search" in row)) return null;
  const spec: SearchSpec = row.search;
  const keys = Object.keys(patch);
  if (keys.length === 0 || !keys.every((k) => k in spec)) return null;
  const next: Record<string, unknown> = { ...r.search };
  for (const k of keys) {
    const v = patch[k];
    next[k] = spec[k]?.read(v === null || v === undefined ? undefined : String(v));
  }
  if (r.route === "mail.lead" && "filter" in patch) return destFrom("mail.list", {}, next);
  if (r.route === "log.list" && "kind" in patch && next.kind === "sends") next.client = null;
  return destFrom(r.route, r.params, next);
}

/**
 * Where a ref is (P72): the destination the dock's "Agent points at … · Show" links to, so his click goes there; the agent
 * never navigates. A knowledge entry has no page of its own: the Knowledge table searched for its title. P99: a client is its
 * conversation; a draft or a stored message is a part of one, so it opens All (the ref does not carry its client).
 */
export function destOfRef(ref: string, title: string | null = null): Dest | null {
  const p = parseRef(ref);
  if (!p) return null;
  switch (p.kind) {
    case "draft":
    case "inbound":
      return dest("mail.list", { filter: "all" });
    case "run":
      // P73: Activity shows no runs; a run's decisions are on the one timeline.
      return dest("log.list");
    case "knowledge":
      return dest("knowledge.page", title ? { q: title } : {});
    case "project":
      return dest("overview.page");
    case "client":
      return dest("mail.conversation", { key: clientKey({ id: Number(p.id) }) });
    case "chat":
    case "mdraft":
      // P108: a chat opens the selected conversation; a draft still opens the linked list until its client ref is available.
      return p.kind === "chat" ? dest("messengers.conversation", { id: Number(p.id) }, { filter: "linked" }) : dest("messengers.page", { filter: "linked" });
  }
}

export const sectionOf = (r: Resolved): SectionId | null => r.section;
