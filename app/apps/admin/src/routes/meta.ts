import { NO_PROJECT, PROJECTLESS, ROUTE_TABLE, type RouteId } from "./table";
import type { Resolved } from "./resolve";
import { sectionTitle } from "./sections";
import { DRAFT_VIEW_LABELS } from "./search";

const APP = "Hub Workflow";

/** Title and breadcrumb per route: read from the route table, the one declaration. */
const metaOf = (id: RouteId): { title: string; crumb: string | null } => {
  const row = ROUTE_TABLE[id];
  return { title: row.title, crumb: "crumb" in row ? row.crumb : null };
};

/** The breadcrumb of a route, outermost first: `["Mail", "Conversation 42"]`, `["Project", "Setup"]` for a child page. Empty for Not found. */
export function crumbsOf(r: Resolved): string[] {
  if (r.route === "notFound") return [];
  const crumbs = [sectionTitle(r.section)];
  const row = ROUTE_TABLE[r.route];
  if ("nav" in row && "parent" in row.nav) crumbs.push(row.title);
  const crumb = metaOf(r.route).crumb;
  if (crumb && "id" in r.params) crumbs.push(`${crumb} ${r.params.id}`);
  return crumbs;
}

/** `Conversation 42 · Mail · lisbon · Hub Workflow`, `Setup · lisbon · Hub Workflow`. The projectless pages name no project. */
export function titleOf(r: Resolved, project: string | null): string {
  if (r.route === "notFound") return `Not found · ${APP}`;
  return pageTitle(r.route, project, "id" in r.params ? r.params.id : "key" in r.params ? r.params.key : undefined);
}

/** The title a page file gives its metadata: `routeId` and the id and project of its own address (a page knows both). */
export function pageTitle(id: RouteId, project: string | null | undefined, item?: number | string): string {
  const { title, crumb } = metaOf(id);
  // P128 X4: a person's address names him ("ana@example.com · Mail · …"); an id keeps its crumb ("Conversation id-12").
  const sub = crumb && item !== undefined ? (typeof item === "string" && item.includes("@") ? item : `${crumb} ${item}`) : null;
  return [sub, title, PROJECTLESS.has(id) ? null : project, APP].filter(Boolean).join(" · ");
}

/**
 * The screen's own words for the shared focus and the dock header (P72): the route table's title (`Knowledge`, `Activity`),
 * `Conversation 42` for an item, `Not found`. The one label map of the screens; the focus keeps no list of its own.
 */
export function screenTitleOf(r: Resolved): string {
  if (r.route === "notFound") return "Not found";
  const { title, crumb } = metaOf(r.route);
  if (crumb && "id" in r.params) return `${crumb} ${r.params.id}`;
  if (crumb && "key" in r.params) return `${crumb} ${r.params.key}`;
  // P96: Mail's view is part of what the screen shows ("Mail · Needs you", "Mail · Waiting"); a batch is its own view.
  if (r.route === "mail.list" && r.search.batch === null) return `${title} · ${DRAFT_VIEW_LABELS[r.search.filter]}`;
  return title;
}

export const NOT_FOUND_TITLE = `Not found · ${APP}`;

/**
 * The project a page file's `[project]` segment names, for its title: none for the segment a bare address is served under
 * (`/mail` is `/_/mail` inside, P127 A2) or one that does not decode, so the title of an address without a project names none.
 */
export function addressedProject(segment: string): string | null {
  if (segment === NO_PROJECT) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
