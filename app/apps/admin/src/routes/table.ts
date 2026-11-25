import type { Route } from "next";
import { AGENT_SEARCH, clientKeyParam, KNOWLEDGE_SEARCH, LEADS_SEARCH, LOG_SEARCH, MAIL_SEARCH, MESSENGERS_SEARCH, notionPage, positiveId, WATCH_SEARCH, type ParamSpec, type SearchOf, type SearchSpec } from "./search";

// `/mail/[id]` read as the number it matches, so `Route<...>` (the union of the pages in `src/app`, plus a string that fits a
// dynamic page) can judge it (decision 0021). P127 A2 (owner remark 2026-11-23): there is ONE route tree. A scoped row's page
// lives only under `src/app/(shell)/[project]/`, so its pattern is judged with `/[project]` in front; a projectless row's page
// is at the top. A path that is not a page of the tree makes `meta` demand `notAPageOfTheTree`, and `tsc` refuses the row.
type Fill<P extends string> = P extends `${infer A}[${string}]${infer B}` ? `${A}${number}${Fill<B>}` : P;
type IsPage<P extends string> = Fill<P> extends Route<Fill<P>> ? true : false;
type PathCheck<P extends string, M> = (M extends { scoped: true } ? IsPage<`/[project]${P}`> : IsPage<P>) extends true ? unknown : { notAPageOfTheTree: P };

/**
 * The segment a bare scoped address is served under (`/mail` is `/_/mail` inside, `src/proxy.ts` rewrites it, never redirects):
 * the `[project]` of an address that names none. `_` is no project slug (`[a-z0-9-]`), and the address bar never shows it.
 */
export const NO_PROJECT = "_";

/** The address as the address bar shows it: the inside form `/_/mail` (the server may render it for `/mail`) is `/mail`. */
export const addressOf = (pathname: string): string => (pathname === `/${NO_PROJECT}` ? "/" : pathname.startsWith(`/${NO_PROJECT}/`) ? pathname.slice(NO_PROJECT.length + 1) : pathname);

/**
 * What the shell reads of a page in the nav (P63 N1). A parent row (no `parent`) is a section: it has its `g` chord and its place
 * on the phone, the tab bar or the More menu. A child row names its parent's route: it is drawn only in the sub-nav of the
 * parent's pages, on every width (P75: never in the sidebar, the rail or the phone bar).
 * Every row is on every instance: with Overview everywhere no row is for several projects only.
 */
export type NavMeta = {
  readonly label: string;
  readonly icon: string;
  readonly order: number;
  /** Parents: required (the check below). Children: none in v1. */
  readonly chord?: string;
  readonly parent?: string;
  /** Parents: the phone tab bar or its More menu. */
  readonly phone?: "bar" | "more";
};
export type RouteMeta = {
  readonly section: string;
  /** True: the address names a project when the instance has two or more (`/<project>/mail`), never a query. */
  readonly scoped: boolean;
  readonly title: string;
  /** The breadcrumb word of an item route (`Draft 42`). */
  readonly crumb?: string;
  /** Only on a section's list route. */
  readonly nav?: NavMeta;
  /** One parser per `[name]` segment of the path (checked below): a value it refuses makes the address Not found. */
  readonly params?: Readonly<Record<string, ParamSpec<unknown>>>;
  /** The query keys the page reads (`routes/search.ts`); a page with none has no search. */
  readonly search?: SearchSpec;
};

/**
 * One row of the route table: the file-tree pattern (checked against `src/app` by `typedRoutes`) and the metadata the shell,
 * the titles and the guard read, with its params and search (P127 A1: `resolve.ts` derives the typed route, `resolveRoute`, `dest`
 * and `useSearch` from them). The same idea as `defineRoute` of `@djangocfg/nextjs/navigation` (the carapis catalogue
 * routes), written here in a few lines: that package also ships sitemap, health, OG and config server utilities with their
 * own dependencies (chalk, conf, consola, semver) and its metadata has no project placement and no typed-route check, so
 * importing it would add weight for an identity function (`architecture-and-ownership.md` rule 14).
 */
export function defineRoute<const P extends string, const M extends RouteMeta>(path: P, meta: M & PathCheck<P, M>) {
  return { path, ...meta } as const;
}

/**
 * The one declaration of which pages exist (decision 0021). Every internal address is built from it (`dest` in `paths.ts`), the
 * nav and the chords derive from its `nav` metadata (`sections.ts`), and nothing concatenates a path at a call site. A scoped row's
 * page is under `src/app/(shell)/[project]/` only, a projectless one's at the top (checked by `defineRoute` and by
 * `test/route-files.test.ts`). It imports the specs of `search.ts` and a type only.
 */
export const ROUTE_TABLE = {
  "overview.page": defineRoute("/overview", { section: "overview", scoped: false, title: "Overview", nav: { label: "Overview", icon: "overview", order: 0, chord: "o", phone: "bar" } }),
  // P96 S3: Drafts became Mail (one section per channel, beside Messengers); its first view is Inbox, the clients who wrote.
  // Chord `e` (`m` is Messengers). The old Drafts addresses are gone, with no redirect (no legacy aliases).
  "mail.list": defineRoute("/mail", { section: "mail", scoped: true, title: "Mail", search: MAIL_SEARCH, nav: { label: "Mail", icon: "inbox", order: 1, chord: "e", phone: "bar" } }),
  // P99 S3: one conversation, the whole correspondence with one client (a `clients` id: stable, an email in a path is not), its
  // unsent draft at the bottom. `/mail/<draft id>` and `/mail/in/<id>` are gone, with no redirect (no legacy aliases).
  // P103: a person by his email (`/mail/c/ana%40example.com`), `id-<n>` without one; the bare number is Not found.
  "mail.conversation": defineRoute("/mail/c/[key]", { section: "mail", scoped: true, title: "Mail", crumb: "Conversation", params: { key: clientKeyParam }, search: MAIL_SEARCH }),
  // P134 verdicts 6-8: Mail ▸ Leads, a page of its own nested under Mail (a sidebar child, not a section): every lead of a view,
  // and one lead by its Notion page id (32 hex), read from Notion Leads. `/mail/lead/<page>` is gone, with no redirect (no legacy
  // aliases, owner 2026-11-08; its only door was the Leads group, which left Mail's list in the same change).
  "mail.leads": defineRoute("/mail/leads", { section: "mail", scoped: true, title: "Leads", search: LEADS_SEARCH }),
  // P147 (decision 0055 point 2): the day's lead batch reviewed on one screen, its one click.
  // P147 3m item 3: what went out, newest first, from the send log (its full text), one row per send with its channel.
  "mail.sent": defineRoute("/mail/sent", { section: "mail", scoped: true, title: "Sent" }),
  "mail.lead-review": defineRoute("/mail/leads/review/[batch]", { section: "mail", scoped: true, title: "Lead review", crumb: "Review", params: { batch: positiveId } }),
  "mail.lead": defineRoute("/mail/leads/[page]", { section: "mail", scoped: true, title: "Leads", crumb: "Lead", params: { page: notionPage }, search: LEADS_SEARCH }),
  // P71 M3 (decision 0036 point 6): what the messengers owe, an analogue of Mail for the linked chats; its landing is the panel
  // (Chats), its child the logins, the bot, each chat's rules and the guards. Mail drafts stay in Mail.
  "messengers.page": defineRoute("/messengers", { section: "messengers", scoped: true, title: "Chats", search: MESSENGERS_SEARCH, nav: { label: "Messengers", icon: "messengers", order: 2, chord: "m", phone: "more" } }),
  "messengers.conversation": defineRoute("/messengers/c/[id]", { section: "messengers", scoped: true, title: "Chats", crumb: "Conversation", params: { id: positiveId }, search: MESSENGERS_SEARCH }),
  // P144 (decision 0052, plan verdict 14, the rule 8a reason): what public groups talk about. Not Messengers: those rows are
  // clients with Reply and drafts, a public group's people are not clients and have no reply path. The nav shows it only when a
  // project of the instance watches public groups (`GET /api/watch`); the row itself is on every instance, like every row.
  "watch.page": defineRoute("/watch", { section: "watch", scoped: true, title: "Watch", search: WATCH_SEARCH, nav: { label: "Watch", icon: "watch", order: 3, chord: "w", phone: "more" } }),
  "log.list": defineRoute("/log", { section: "log", scoped: true, title: "Activity", search: LOG_SEARCH, nav: { label: "Activity", icon: "activity", order: 4, chord: "a", phone: "bar" } }),
  "knowledge.page": defineRoute("/knowledge", { section: "knowledge", scoped: true, title: "Knowledge", search: KNOWLEDGE_SEARCH, nav: { label: "Knowledge", icon: "knowledge", order: 5, chord: "k", phone: "more" } }),
  // P70: Settings opens on its first pane, Sending (the row's title); the nav names the section, the sub-nav the pane.
  "settings.page": defineRoute("/settings", { section: "settings", scoped: true, title: "Sending", nav: { label: "Settings", icon: "settings", order: 6, chord: "s", phone: "bar" } }),
  // P75: the checks before sending are their own pane, next to Sending (guards on each draft, a different kind of setting).
  "settings.checks": defineRoute("/settings/checks", { section: "settings", scoped: true, title: "Checks", nav: { label: "Checks", icon: "checks", order: 1, parent: "settings.page" } }),
  "settings.mail": defineRoute("/settings/mail", { section: "settings", scoped: true, title: "Mail", nav: { label: "Mail", icon: "mail", order: 2, parent: "settings.page" } }),
  // P125 L5: Messengers' settings are a Settings group (the Messengers section has one page); `/messengers/settings` is gone, no redirect.
  "settings.messengers": defineRoute("/settings/messengers", { section: "settings", scoped: true, title: "Messengers", nav: { label: "Messengers", icon: "messengers", order: 3, parent: "settings.page" } }),
  "settings.agent": defineRoute("/settings/agent", { section: "settings", scoped: true, title: "Agent", search: AGENT_SEARCH, nav: { label: "Agent", icon: "agents", order: 4, parent: "settings.page" } }),
  "settings.connections": defineRoute("/settings/connections", { section: "settings", scoped: false, title: "Connections", nav: { label: "Connections", icon: "connections", order: 5, parent: "settings.page" } }),
  "settings.mac": defineRoute("/settings/mac", { section: "settings", scoped: false, title: "This Mac", nav: { label: "This Mac", icon: "mac", order: 6, parent: "settings.page" } }),
  "help.page": defineRoute("/help", { section: "help", scoped: false, title: "Help", nav: { label: "Help", icon: "help", order: 7, chord: "h", phone: "more" } }),
} as const;

export type RouteId = keyof typeof ROUTE_TABLE;
type Row = (typeof ROUTE_TABLE)[RouteId];
export type RowOf<K extends RouteId> = (typeof ROUTE_TABLE)[K];
/** No params, no search: the keys of a page without them (`"id" in r.params` narrows the rest). */
export type NoParams = Record<string, never>;
export type NoSearch = Record<string, never>;
/** A route's typed params and search, derived from its row (P127 A1). */
export type ParamsOf<K extends RouteId> = RowOf<K> extends { params: infer P } ? { -readonly [N in keyof P]: P[N] extends ParamSpec<infer T> ? T : never } : NoParams;
export type SearchFor<K extends RouteId> = RowOf<K> extends { search: infer S } ? SearchOf<S> : NoSearch;
/** The routes whose path takes a parameter (`/mail/c/[id]`): they have no bare destination. */
export type ParamRouteId = { [K in RouteId]: RowOf<K> extends { params: object } ? K : never }[RouteId];

// A nav row is a parent (a chord and a phone place, no `parent`) or a child (a `parent` that is a parent row, no chord, no phone
// place); anything else fails here, naming the row. Scope (P70): a child has its parent's scope, or is projectless under a scoped
// parent (Settings ▸ Connections, This Mac: the instance's panes beside the project's); a scoped child under a projectless parent
// is refused, since the parent's address could not carry the project its child needs.
type Parent<R> = R extends { nav: { parent: string } } ? never : R extends { nav: { chord: string; phone: string } } ? R : never;
export type NavCheck<R> = R extends { nav: infer N }
  ? N extends { parent: infer P }
    ? P extends RouteId
      ? [Parent<RowOf<P>>] extends [never]
        ? never
        : N extends { chord: string } | { phone: string }
          ? never
          : R extends { scoped: false }
            ? true
            : R extends { scoped: RowOf<P>["scoped"] }
              ? true
              : never
      : never
    : [Parent<R>] extends [never] ? never : true
  : true;
type BadNav = { [K in RouteId]: [NavCheck<RowOf<K>>] extends [never] ? K : never }[RouteId];
export const NAV_SHAPE: [BadNav] extends [never] ? true : { badNav: BadNav } = true;

// The params of a row are exactly the `[name]` segments of its path: a missing or an extra parser fails here, naming the row.
type ParamNames<P extends string> = P extends `${string}[${infer N}]${infer Rest}` ? N | ParamNames<Rest> : never;
type ParamsMatch<R> = R extends { path: infer P extends string } ? (R extends { params: infer Q } ? ([keyof Q] extends [ParamNames<P>] ? ([ParamNames<P>] extends [keyof Q] ? true : never) : never) : [ParamNames<P>] extends [never] ? true : never) : never;
type BadParams = { [K in RouteId]: [ParamsMatch<RowOf<K>>] extends [never] ? K : never }[RouteId];
export const PARAMS_MATCH: [BadParams] extends [never] ? true : { badParams: BadParams } = true;

const ID = String.raw`[1-9]\d*`;
/**
 * One project segment of a multi-project address: anything but a slash, a query or a fragment (the slug is URL-encoded), and
 * never the inside segment `_` (P127 A2: the rewrite's, so no destination is ever written with it).
 */
const SLUG = String.raw`(?!${NO_PROJECT}[/?#])[^/?#]+`;
const PAGE_ID = "[0-9a-f]{32}";
/** A client key in the address (P103): an encoded email or `id-<n>`; `clientKeyParam` then decides (a bare number is Not found). */
const KEY = "[^/?#]+";
const escape = (p: string): string => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\[id\\]", () => ID).replace("\\[page\\]", () => PAGE_ID).replace("\\[key\\]", () => KEY);

const isRouteId = (k: string): k is RouteId => k in ROUTE_TABLE;
export const ROUTE_IDS: readonly RouteId[] = Object.keys(ROUTE_TABLE).filter(isRouteId);
const rows: readonly Row[] = Object.values(ROUTE_TABLE);
const pattern = (r: Row): string => (r.scoped ? `(?:/${SLUG})?${escape(r.path)}` : escape(r.path));

/** Every address of the tree (a scoped one with or without its project) and the entry `/`, with an optional query: the run-time door `routeOf` accepts exactly these. */
export const PAGE = new RegExp(`^(/|${rows.map(pattern).join("|")})(\\?[^#]*)?$`);

/**
 * The routes about the whole instance (Overview, Help, Settings ▸ Connections and This Mac): their address never names a project,
 * and their page exists once, at the top of the tree. A project segment before one is Not found (`/lisbon/settings/connections`).
 */
export const PROJECTLESS: ReadonlySet<RouteId> = new Set(ROUTE_IDS.filter((id) => !ROUTE_TABLE[id].scoped));

/** The first path segments that are sections, not projects: a project with one of these names cannot be addressed by path. */
export const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([...rows.map((r) => r.path.split("/")[1] ?? ""), "health", "api", NO_PROJECT]);

/** The first segments of the scoped rows, and the projectless rows' paths: what `src/proxy.ts` needs to rewrite a bare scoped address. */
export const SCOPED_HEADS: ReadonlySet<string> = new Set(rows.filter((r) => r.scoped).map((r) => r.path.split("/")[1] ?? ""));
export const PROJECTLESS_PATHS: ReadonlySet<string> = new Set(rows.filter((r) => !r.scoped).map((r) => r.path));

/** The list route of a section: its parent row (with `nav` and no `parent`). */
export function listRouteOf(section: string): RouteId {
  const id = ROUTE_IDS.find((k) => {
    const r: Row = ROUTE_TABLE[k];
    return r.section === section && "nav" in r && !("parent" in r.nav);
  });
  if (!id) throw new Error(`no route for section ${section}`);
  return id;
}
