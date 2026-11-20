import { parseRef } from "@hub/contract/focus";
import { paths, type Dest } from "./paths";
import { draftsSearch, knowledgeSearch, logSearch, noSearch, parseQuery, positiveInt, type DraftsSearch, type KnowledgeSearch, type LogSearch, type NoSearch } from "./search";
import type { SectionId } from "./sections";
import { PROJECTLESS, RESERVED_SEGMENTS, ROUTE_TABLE } from "./table";

/**
 * The first segments of the projectless sections (`overview`, `help`): a project segment before one is Not found. A projectless
 * child under a scoped parent (`settings/connections`, P70) is not one: `/<project>/settings/connections` resolves, and the guard
 * folds it to `/settings/connections`, since the sub-nav of a scoped pane may be followed with the project in mind.
 */
const PROJECTLESS_HEADS: ReadonlySet<string> = new Set([...PROJECTLESS].map((id) => ROUTE_TABLE[id].path.split("/")).filter((p) => p.length === 2).map((p) => p[1] ?? ""));

/**
 * `project`: the project the address names, from its first path segment (`/lisbon/drafts`). `inPath` says it came from the
 * path. `entry`: the bare `/`, decided by the guard (Drafts, or Overview with two or more projects).
 */
type Base = { project: string | null; inPath: boolean; entry: boolean };
/** The address as a value. `notFound` is a real state: an unknown path or a non-numeric id never shows another screen. */
export type Resolved =
  | (Base & { route: "overview.page"; section: "overview"; params: NoSearch; search: NoSearch })
  | (Base & { route: "drafts.list"; section: "drafts"; params: NoSearch; search: DraftsSearch })
  | (Base & { route: "drafts.item"; section: "drafts"; params: { id: number }; search: DraftsSearch })
  | (Base & { route: "log.list"; section: "log"; params: NoSearch; search: LogSearch })
  | (Base & { route: "knowledge.page"; section: "knowledge"; params: NoSearch; search: KnowledgeSearch })
  | (Base & { route: "settings.page"; section: "settings"; params: NoSearch; search: NoSearch })
  | (Base & { route: "settings.mail"; section: "settings"; params: NoSearch; search: NoSearch })
  | (Base & { route: "settings.agent"; section: "settings"; params: NoSearch; search: NoSearch })
  | (Base & { route: "settings.connections"; section: "settings"; params: NoSearch; search: NoSearch })
  | (Base & { route: "settings.mac"; section: "settings"; params: NoSearch; search: NoSearch })
  | (Base & { route: "help.page"; section: "help"; params: NoSearch; search: NoSearch })
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
  if (segs.length > 2 || (inPath && (project === null || head === undefined || PROJECTLESS_HEADS.has(head)))) return notFound;
  switch (head) {
    case "overview":
      return one ? { ...base, route: "overview.page", section: "overview", params: {}, search: noSearch() } : notFound;
    case "help":
      return one ? { ...base, route: "help.page", section: "help", params: {}, search: noSearch() } : notFound;
    case "knowledge":
      return one ? { ...base, route: "knowledge.page", section: "knowledge", params: {}, search: knowledgeSearch(raw) } : notFound;
    case undefined: // the empty address is the entry
    case "drafts":
      if (segs.length <= 1) return { ...base, route: "drafts.list", section: "drafts", params: {}, search: draftsSearch(raw) };
      return id === null ? notFound : { ...base, route: "drafts.item", section: "drafts", params: { id }, search: draftsSearch(raw) };
    case "log":
      return one ? { ...base, route: "log.list", section: "log", params: {}, search: logSearch(raw) } : notFound;
    case "settings":
      if (one) return { ...base, route: "settings.page", section: "settings", params: {}, search: noSearch() };
      if (tail === "mail") return { ...base, route: "settings.mail", section: "settings", params: {}, search: noSearch() };
      if (tail === "agent") return { ...base, route: "settings.agent", section: "settings", params: {}, search: noSearch() };
      if (tail === "connections") return { ...base, route: "settings.connections", section: "settings", params: {}, search: noSearch() };
      if (tail === "mac") return { ...base, route: "settings.mac", section: "settings", params: {}, search: noSearch() };
      return notFound;
    default:
      return notFound;
  }
}

/** A route back into the destination that addresses it (the canonical form). Null for not-found. */
export function destOf(r: Resolved): Dest | null {
  switch (r.route) {
    case "overview.page":
      return paths.overview();
    case "drafts.list":
      return paths.drafts.list(r.search);
    case "drafts.item":
      return paths.drafts.item(r.params.id, r.search);
    case "log.list":
      return paths.log.list(r.search);
    case "knowledge.page":
      return paths.knowledge.page(r.search);
    case "settings.page":
      return paths.settings.sending();
    case "settings.mail":
      return paths.settings.mail();
    case "settings.agent":
      return paths.settings.agent();
    case "settings.connections":
      return paths.settings.connections();
    case "settings.mac":
      return paths.settings.mac();
    case "help.page":
      return paths.help.page();
    case "notFound":
      return null;
  }
}

/**
 * Where a ref is (P72): the destination the dock's "Agent points at … · Show" links to, so his click goes there; the agent
 * never navigates. A knowledge entry has no page of its own: the Knowledge table searched for its title. Null: no screen
 * shows that kind (a client).
 */
export function destOfRef(ref: string, title: string | null = null): Dest | null {
  const p = parseRef(ref);
  if (!p) return null;
  switch (p.kind) {
    case "draft":
      return paths.drafts.item(Number(p.id), { filter: "all" });
    case "run":
      return paths.log.list({ run: Number(p.id) });
    case "knowledge":
      return paths.knowledge.page(title ? { q: title } : {});
    case "project":
      return paths.overview();
    case "client":
      return null;
  }
}

export const sectionOf = (r: Resolved): SectionId | null => r.section;
