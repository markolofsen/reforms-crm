import { paths, type Dest } from "./paths";
import { draftsSearch, logSearch, noSearch, overviewSearch, parseQuery, positiveInt, type DraftsSearch, type LogSearch, type NoSearch, type OverviewSearch } from "./search";
import type { SectionId } from "./sections";

type Base = { project: string | null };
/** The address as a value. `notFound` is a real state: an unknown path or a non-numeric id never shows another screen. */
export type Resolved =
  | (Base & { route: "overview.page"; section: "overview"; params: NoSearch; search: OverviewSearch })
  | (Base & { route: "connections.page"; section: "connections"; params: NoSearch; search: NoSearch })
  | (Base & { route: "drafts.list"; section: "drafts"; params: NoSearch; search: DraftsSearch })
  | (Base & { route: "drafts.item"; section: "drafts"; params: { id: number }; search: DraftsSearch })
  | (Base & { route: "log.list"; section: "log"; params: NoSearch; search: LogSearch })
  | (Base & { route: "project.page"; section: "project"; params: NoSearch; search: NoSearch })
  | (Base & { route: "notFound"; section: null; path: string });

/**
 * `path` and `search` of the address into a typed route. Pure: the hooks hand it the two strings and nothing else. The file
 * tree decides what renders; this decides what the shell and the hooks read of the address, and `test/route-files.test.ts`
 * fails when the two disagree about which pages exist.
 */
export function resolveRoute(path: string, searchString: string): Resolved {
  const raw = parseQuery(searchString);
  const project = raw.project ? raw.project : null;
  const segs = path.split("/").filter(Boolean);
  const [head, tail] = segs;
  const id = positiveInt(tail);
  const notFound: Resolved = { route: "notFound", section: null, project, path };
  if (segs.length > 2) return notFound;
  switch (head) {
    case "overview":
      return segs.length === 1 ? { route: "overview.page", section: "overview", project, params: {}, search: overviewSearch(raw) } : notFound;
    case "connections":
      return segs.length === 1 ? { route: "connections.page", section: "connections", project, params: {}, search: noSearch() } : notFound;
    case undefined: // the empty address is the entry: Drafts
    case "drafts":
      if (segs.length <= 1) return { route: "drafts.list", section: "drafts", project, params: {}, search: draftsSearch(raw) };
      return id === null ? notFound : { route: "drafts.item", section: "drafts", project, params: { id }, search: draftsSearch(raw) };
    case "log":
      return segs.length === 1 ? { route: "log.list", section: "log", project, params: {}, search: logSearch(raw) } : notFound;
    case "project":
      return segs.length === 1 ? { route: "project.page", section: "project", project, params: {}, search: noSearch() } : notFound;
    default:
      return notFound;
  }
}

/** A route back into the destination that addresses it (the canonical form). Null for not-found. */
export function destOf(r: Resolved): Dest | null {
  switch (r.route) {
    case "overview.page":
      return paths.overview({ focus: r.search.focus ?? undefined });
    case "connections.page":
      return paths.connections.page();
    case "drafts.list":
      return r.search.new ? paths.drafts.newBatch() : paths.drafts.list(r.search);
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
