import { PROJECTLESS, ROUTE_TABLE, type RouteId } from "./table";
import type { Resolved } from "./resolve";
import { sectionTitle } from "./sections";

const APP = "Hub Workflow";

/** Title and breadcrumb per route: read from the route table, the one declaration. */
const metaOf = (id: RouteId): { title: string; crumb: string | null } => {
  const row = ROUTE_TABLE[id];
  return { title: row.title, crumb: "crumb" in row ? row.crumb : null };
};

/** The breadcrumb of a route, outermost first: `["Drafts", "Draft 42"]`. Empty for Not found. */
export function crumbsOf(r: Resolved): string[] {
  if (r.section === null) return [];
  const crumbs = [sectionTitle(r.section)];
  const crumb = metaOf(r.route).crumb;
  if (crumb && "id" in r.params) crumbs.push(`${crumb} ${r.params.id}`);
  return crumbs;
}

/** `Draft 42 · Drafts · lisbon · Hub Workflow`. Overview and Connections are about the instance, so their titles name no project. */
export function titleOf(r: Resolved, project: string | null): string {
  if (r.section === null) return `Not found · ${APP}`;
  const [section = "", item] = crumbsOf(r);
  return [item, section, r.section === "overview" || r.section === "connections" ? null : project, APP].filter(Boolean).join(" · ");
}

/** The title a page file gives its metadata: `routeId` and the id and project of its own address (a page knows both). */
export function pageTitle(id: RouteId, project: string | null | undefined, item?: number): string {
  const { title, crumb } = metaOf(id);
  const sub = crumb && item !== undefined ? `${crumb} ${item}` : null;
  return [sub, title, PROJECTLESS.has(id) ? null : project, APP].filter(Boolean).join(" · ");
}

export const NOT_FOUND_TITLE = `Not found · ${APP}`;
