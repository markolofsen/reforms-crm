import { PROJECTLESS, type RouteId } from "./table";
import type { Resolved } from "./resolve";
import { sectionTitle } from "./sections";

const APP = "Hub Workflow";

/** Title and breadcrumb per route: the one declaration the document title and the detail header read. */
export const ROUTE_META: Record<RouteId, { title: string; crumb: string | null }> = {
  "overview.page": { title: "Overview", crumb: null },
  "connections.page": { title: "Connections", crumb: null },
  "drafts.list": { title: "Drafts", crumb: null },
  "drafts.item": { title: "Drafts", crumb: "Draft" },
  "bulk.list": { title: "Bulk", crumb: null },
  "bulk.item": { title: "Bulk", crumb: "Batch" },
  "log.list": { title: "Activity", crumb: null },
  "project.page": { title: "Project", crumb: null },
};

/** The breadcrumb of a route, outermost first: `["Drafts", "Draft 42"]`. Empty for Not found. */
export function crumbsOf(r: Resolved): string[] {
  if (r.section === null) return [];
  const crumbs = [sectionTitle(r.section)];
  const crumb = ROUTE_META[r.route].crumb;
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
  const { title, crumb } = ROUTE_META[id];
  const sub = crumb && item !== undefined ? `${crumb} ${item}` : null;
  return [sub, title, PROJECTLESS.has(id) ? null : project, APP].filter(Boolean).join(" · ");
}

export const NOT_FOUND_TITLE = `Not found · ${APP}`;
