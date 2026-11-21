import { DEFAULT_DRAFT_VIEW, formatQuery, unlessDefault, type AgentView, type DraftView, type KnowledgeView, type ActivityView, type MessengerChannelFilter, type MessengerView } from "./search";
import type { SectionId } from "./sections";
import { listRouteOf, PROJECTLESS, ROUTE_TABLE, type RouteId } from "./table";
import { route } from "./typed";

export type { RouteId };

/** A destination: which route, its path without a project, and the search it carries. Where the project goes is the `Place`'s. */
export type Dest = { readonly route: RouteId; readonly path: string; readonly search: Readonly<Record<string, string>> };

/**
 * Where an address is: the project and whether the instance has two or more. One project: no project in any address
 * (`/mail/c/42`). Two or more: the project is the first path segment of a scoped route (`/lisbon/mail/c/42`), never a query.
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
    checks: () => dest("settings.checks", route("/settings/checks")),
    mail: () => dest("settings.mail", route("/settings/mail")),
    agent: (s: { filter?: AgentView } = {}) => dest("settings.agent", route("/settings/agent"), { filter: unlessDefault(s.filter, "attention") }),
    connections: () => dest("settings.connections", route("/settings/connections")),
    mac: () => dest("settings.mac", route("/settings/mac")),
  },
  /** P71 M3: the panel (`/messengers`, To do and every channel by default, P84c) and Messengers ▸ Settings. */
  messengers: {
    chats: (s: { filter?: MessengerView; channel?: MessengerChannelFilter } = {}) =>
      dest("messengers.page", route("/messengers"), { filter: unlessDefault(s.filter, "todo"), channel: unlessDefault(s.channel, "all") }),
    settings: () => dest("messengers.settings", route("/messengers/settings")),
  },
  /** P99: Mail lists people: the views, and one conversation (`/mail/c/7`, a client id; `m` scrolls to one of their messages). */
  mail: {
    list: (s: DraftsArgs = {}) => dest("mail.list", route("/mail"), { filter: unlessDefault(s.filter, DEFAULT_DRAFT_VIEW), q: s.q, batch: s.batch }),
    conversation: (clientId: number, s: DraftsArgs & { m?: string | null } = {}) => dest("mail.conversation", route(`/mail/c/${clientId}`), { filter: unlessDefault(s.filter, DEFAULT_DRAFT_VIEW), q: s.q, batch: s.batch, m: s.m }),
    /** P97 S2: one lead of the Leads group (`/mail/lead/<32 hex>`), Inbox's card like a client's message. */
    lead: (pageId: string, s: DraftsArgs = {}) => dest("mail.lead", route(`/mail/lead/${pageId}`), { filter: unlessDefault(s.filter, DEFAULT_DRAFT_VIEW), q: s.q, batch: s.batch }),
  },
  log: {
    list: (s: { filter?: ActivityView; client?: number | null } = {}) => dest("log.list", route("/log"), { filter: unlessDefault(s.filter, "all"), client: s.client }),
  },
};

/** The list destination of a section (the nav item, the chord, the project switch). */
export function sectionList(id: SectionId): Dest {
  const r = listRouteOf(id);
  return dest(r, ROUTE_TABLE[r].path);
}

/** The bare destination of a route with no parameter (a nav item, a child page of the sub-nav, the page a dot names). */
export function routeDest(id: Exclude<RouteId, "mail.conversation" | "mail.lead">): Dest {
  return dest(id, ROUTE_TABLE[id].path);
}

/** The address text of a destination: `/mail/c/42?filter=all` with one project, `/lisbon/mail/c/42?filter=all` with several. */
export function formatDest(d: Dest, place: Place): string {
  const prefix = place.multi && place.project && !PROJECTLESS.has(d.route) ? `/${encodeURIComponent(place.project)}` : "";
  return `${prefix}${d.path}${formatQuery(d.search)}`;
}
