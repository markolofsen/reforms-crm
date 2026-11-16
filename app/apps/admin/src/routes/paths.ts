import { DEFAULT_DRAFT_VIEW, formatQuery, unlessDefault, type BatchFilter, type DraftView, type RunFilter } from "./search";
import type { SectionId } from "./sections";
import { route } from "./typed";

export type RouteId = "overview.page" | "drafts.list" | "drafts.item" | "bulk.list" | "bulk.item" | "log.list" | "project.page";

/** A destination: which route, its path, and the search it carries (project excluded: the link adds the current one). */
export type Dest = { readonly route: RouteId; readonly path: string; readonly search: Readonly<Record<string, string>> };

function dest(route: RouteId, path: string, query: Readonly<Record<string, string | number | boolean | null | undefined>> = {}): Dest {
  const search: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(formatQuery(query))) search[k] = v;
  return { route, path, search };
}

/**
 * The ONLY producers of a destination. A component never writes a path; a wrong name or value fails `tsc`. The path half
 * goes through `route()`, so `typedRoutes` checks it against the file tree: a page that does not exist fails the build.
 */
export const paths = {
  overview: (s: { focus?: string } = {}) => dest("overview.page", route("/overview"), { focus: s.focus }),
  drafts: {
    list: (s: { filter?: DraftView; q?: string } = {}) => dest("drafts.list", route("/drafts"), { filter: unlessDefault(s.filter, DEFAULT_DRAFT_VIEW), q: s.q }),
    item: (id: number, s: { filter?: DraftView; q?: string } = {}) => dest("drafts.item", route(`/drafts/${id}`), { filter: unlessDefault(s.filter, DEFAULT_DRAFT_VIEW), q: s.q }),
  },
  bulk: {
    list: () => dest("bulk.list", route("/bulk")),
    new: () => dest("bulk.list", route("/bulk"), { new: true }),
    item: (id: number, s: { filter?: BatchFilter } = {}) => dest("bulk.item", route(`/bulk/${id}`), { filter: unlessDefault(s.filter, "all") }),
  },
  log: {
    list: (s: { filter?: RunFilter; run?: number | null } = {}) => dest("log.list", route("/log"), { filter: unlessDefault(s.filter, "all"), run: s.run }),
  },
  project: {
    page: () => dest("project.page", route("/project")),
  },
};

/** The list destination of a section (the nav item, the chord, the project switch). */
export function sectionList(id: SectionId): Dest {
  switch (id) {
    case "overview":
      return paths.overview();
    case "drafts":
      return paths.drafts.list();
    case "bulk":
      return paths.bulk.list();
    case "log":
      return paths.log.list();
    case "project":
      return paths.project.page();
  }
}

/** The address text of a destination, `/drafts/42?project=lisbon&filter=ready`. The project is first, as in a bookmark. */
export function formatDest(d: Dest, project: string | null): string {
  // Overview is cross-project: its address never names one (`routes-and-url-state.md` rule 8, the one exemption).
  const q = formatQuery({ project: d.route === "overview.page" ? null : project, ...d.search });
  return `${d.path}${q}`;
}

/** The query of a destination as an ordered record, project first, for `AppLink` to hand to the framework link. */
export function queryOf(d: Dest, project: string | null): Record<string, string> {
  const q: Record<string, string> = {};
  if (project && d.route !== "overview.page") q.project = project;
  return { ...q, ...d.search };
}
