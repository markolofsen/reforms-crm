import { paths, type Dest } from "./paths";
import { draftsSearch, logSearch, noSearch, parseQuery, positiveInt, type DraftsSearch, type LogSearch, type NoSearch } from "./search";
import type { SectionId } from "./sections";
import { RESERVED_SEGMENTS } from "./table";

/**
 * `project`: the project the address names, from its first path segment (`/lisbon/drafts`). `inPath` says it came from the
 * path. `entry`: the bare `/`, decided by the guard (Drafts, or Overview with two or more projects).
 */
type Base = { project: string | null; inPath: boolean; entry: boolean };
/** The address as a value. `notFound` is a real state: an unknown path or a non-numeric id never shows another screen. */
export type Resolved =
  | (Base & { route: "overview.page"; section: "overview"; params: NoSearch; search: NoSearch })
  | (Base & { route: "connections.page"; section: "connections"; params: NoSearch; search: NoSearch })
  | (Base & { route: "drafts.list"; section: "drafts"; params: NoSearch; search: DraftsSearch })
  | (Base & { route: "drafts.item"; section: "drafts"; params: { id: number }; search: DraftsSearch })
  | (Base & { route: "log.list"; section: "log"; params: NoSearch; search: LogSearch })
  | (Base & { route: "project.page"; section: "project"; params: NoSearch; search: NoSearch })
  | (Base & { route: "notFound"; section: null; path: string });

const decode = (s: string): string | null => {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
};

/**
 * `path` and `search` of the address into a typed route. Pure: the hooks hand it the two strings and nothing else. The file
 * tree decides what renders; this decides what the shell and the hooks read of the address, and `test/route-files.test.ts`
 * fails when the two disagree about which pages exist.
 */
export function resolveRoute(path: string, searchString: string): Resolved {
  const raw = parseQuery(searchString);
  const all = path.split("/").filter(Boolean);
  const inPath = all.length > 0 && !RESERVED_SEGMENTS.has(all[0] ?? "");
  // Saved links of the query-string era (`/drafts/1?project=lisbon`, until 2026-11-18, P48): the project is read here, once,
  // and the guard writes the address back in the path form (`canonicalAddress`). Delete when no saved link can still hold it.
  const legacy = raw.project ? raw.project : null;
  const project = inPath ? decode(all[0] ?? "") : legacy;
  const segs = inPath ? all.slice(1) : all;
  const base: Base = { project, inPath, entry: all.length === 0 };
  const [head, tail] = segs;
  const id = positiveInt(tail);
  const notFound: Resolved = { ...base, route: "notFound", section: null, path };
  const one = segs.length === 1;
  // A project segment heads a scoped section only; `/lisbon`, `/lisbon/overview` and an undecodable slug are Not found.
  if (segs.length > 2 || (inPath && (project === null || head === "overview" || head === "connections" || head === undefined))) return notFound;
  switch (head) {
    case "overview":
      return one ? { ...base, route: "overview.page", section: "overview", params: {}, search: noSearch() } : notFound;
    case "connections":
      return one ? { ...base, route: "connections.page", section: "connections", params: {}, search: noSearch() } : notFound;
    case undefined: // the empty address is the entry
    case "drafts":
      if (segs.length <= 1) return { ...base, route: "drafts.list", section: "drafts", params: {}, search: draftsSearch(raw) };
      return id === null ? notFound : { ...base, route: "drafts.item", section: "drafts", params: { id }, search: draftsSearch(raw) };
    case "log":
      return one ? { ...base, route: "log.list", section: "log", params: {}, search: logSearch(raw) } : notFound;
    case "project":
      return one ? { ...base, route: "project.page", section: "project", params: {}, search: noSearch() } : notFound;
    default:
      return notFound;
  }
}

/** A route back into the destination that addresses it (the canonical form). Null for not-found. */
export function destOf(r: Resolved): Dest | null {
  switch (r.route) {
    case "overview.page":
      return paths.overview();
    case "connections.page":
      return paths.connections.page();
    case "drafts.list":
      return paths.drafts.list(r.search);
    case "drafts.item":
      return paths.drafts.item(r.params.id, r.search);
    case "log.list":
      return paths.log.list(r.search);
    case "project.page":
      return paths.project.page();
    case "notFound":
      return null;
  }
}

export const sectionOf = (r: Resolved): SectionId | null => r.section;
