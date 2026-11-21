import type { Route } from "next";

// `/mail/[id]` read as the number it matches, so `Route<...>` (the union of the pages in `src/app`, plus a string that fits a
// dynamic page) can judge it; a path that is not a page makes the parameter `never` and `tsc` refuses the row (decision 0021).
type Fill<P extends string> = P extends `${infer A}[${string}]${infer B}` ? `${A}${number}${Fill<B>}` : P;
type Checked<P extends string> = Fill<P> extends Route<Fill<P>> ? P : never;

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
};

/**
 * One row of the route table: the file-tree pattern (checked against `src/app` by `typedRoutes`) and the metadata the shell,
 * the titles and the guard read. The same idea as `defineRoute` of `@djangocfg/nextjs/navigation` (the carapis catalogue
 * routes), written here in a few lines: that package also ships sitemap, health, OG and config server utilities with their
 * own dependencies (chalk, conf, consola, semver) and its metadata has no project placement and no typed-route check, so
 * importing it would add weight for an identity function (`architecture-and-ownership.md` rule 14).
 */
export function defineRoute<const P extends string, const M extends RouteMeta>(path: Checked<P>, meta: M) {
  return { path, ...meta } as const;
}

/**
 * The one declaration of which pages exist (decision 0021). Every internal address is built from it (`paths.ts`), the nav and
 * the chords derive from its `nav` metadata (`sections.ts`), and nothing concatenates a path at a call site. A scoped row has a
 * twin page under `src/app/(shell)/[project]/` (checked below and by `test/route-files.test.ts`). No imports but a type.
 */
export const ROUTE_TABLE = {
  "overview.page": defineRoute("/overview", { section: "overview", scoped: false, title: "Overview", nav: { label: "Overview", icon: "overview", order: 0, chord: "o", phone: "bar" } }),
  // P96 S3: Drafts became Mail (one section per channel, beside Messengers); its first view is Inbox, the clients who wrote.
  // Chord `e` (`m` is Messengers). The old Drafts addresses are gone, with no redirect (no legacy aliases).
  "mail.list": defineRoute("/mail", { section: "mail", scoped: true, title: "Mail", nav: { label: "Mail", icon: "inbox", order: 1, chord: "e", phone: "bar" } }),
  "mail.item": defineRoute("/mail/[id]", { section: "mail", scoped: true, title: "Mail", crumb: "Draft" }),
  // P96 S1: one message a client wrote, read from Mail (the Inbox view's card).
  "mail.inbound": defineRoute("/mail/in/[id]", { section: "mail", scoped: true, title: "Mail", crumb: "Message" }),
  // P97 S2: one lead of the Inbox's Leads group, by its Notion page id (32 hex), read from Notion Leads.
  "mail.lead": defineRoute("/mail/lead/[page]", { section: "mail", scoped: true, title: "Mail", crumb: "Lead" }),
  // P71 M3 (decision 0036 point 6): what the messengers owe, an analogue of Mail for the linked chats; its landing is the panel
  // (Chats), its child the logins, the bot, each chat's rules and the guards. Mail drafts stay in Mail.
  "messengers.page": defineRoute("/messengers", { section: "messengers", scoped: true, title: "Chats", nav: { label: "Messengers", icon: "messengers", order: 2, chord: "m", phone: "more" } }),
  "messengers.settings": defineRoute("/messengers/settings", { section: "messengers", scoped: true, title: "Messenger settings", nav: { label: "Settings", icon: "settings", order: 1, parent: "messengers.page" } }),
  "log.list": defineRoute("/log", { section: "log", scoped: true, title: "Activity", nav: { label: "Activity", icon: "activity", order: 3, chord: "a", phone: "bar" } }),
  "knowledge.page": defineRoute("/knowledge", { section: "knowledge", scoped: true, title: "Knowledge", nav: { label: "Knowledge", icon: "knowledge", order: 4, chord: "k", phone: "more" } }),
  // P70: Settings opens on its first pane, Sending (the row's title); the nav names the section, the sub-nav the pane.
  "settings.page": defineRoute("/settings", { section: "settings", scoped: true, title: "Sending", nav: { label: "Settings", icon: "settings", order: 5, chord: "s", phone: "bar" } }),
  // P75: the checks before sending are their own pane, next to Sending (guards on each draft, a different kind of setting).
  "settings.checks": defineRoute("/settings/checks", { section: "settings", scoped: true, title: "Checks", nav: { label: "Checks", icon: "checks", order: 1, parent: "settings.page" } }),
  "settings.mail": defineRoute("/settings/mail", { section: "settings", scoped: true, title: "Mail", nav: { label: "Mail", icon: "mail", order: 2, parent: "settings.page" } }),
  "settings.agent": defineRoute("/settings/agent", { section: "settings", scoped: true, title: "Agent", nav: { label: "Agent", icon: "agents", order: 3, parent: "settings.page" } }),
  "settings.connections": defineRoute("/settings/connections", { section: "settings", scoped: false, title: "Connections", nav: { label: "Connections", icon: "connections", order: 4, parent: "settings.page" } }),
  "settings.mac": defineRoute("/settings/mac", { section: "settings", scoped: false, title: "This Mac", nav: { label: "This Mac", icon: "mac", order: 5, parent: "settings.page" } }),
  "help.page": defineRoute("/help", { section: "help", scoped: false, title: "Help", nav: { label: "Help", icon: "help", order: 6, chord: "h", phone: "more" } }),
} as const;

export type RouteId = keyof typeof ROUTE_TABLE;
type Row = (typeof ROUTE_TABLE)[RouteId];

// A scoped row without its `[project]` twin page makes the property `never`, and `true` fails `tsc`. So does a projectless child
// of a scoped parent (P70) without its fold page (see `PROJECTLESS`).
type Twin<R> = R extends { path: infer P extends string; scoped: true } ? Checked<`/[project]${P}`> : R extends { path: infer P extends string; nav: { parent: string } } ? Checked<`/[project]${P}`> : string;
export const TWINS: { readonly [K in RouteId]: [Twin<(typeof ROUTE_TABLE)[K]>] extends [never] ? never : true } = {
  "overview.page": true,
  "mail.list": true,
  "mail.item": true,
  "mail.inbound": true,
  "mail.lead": true,
  "messengers.page": true,
  "messengers.settings": true,
  "log.list": true,
  "knowledge.page": true,
  "settings.page": true,
  "settings.checks": true,
  "settings.mail": true,
  "settings.agent": true,
  "settings.connections": true,
  "settings.mac": true,
  "help.page": true,
};

// A nav row is a parent (a chord and a phone place, no `parent`) or a child (a `parent` that is a parent row, no chord, no phone
// place); anything else makes the property `never`, and `true` fails `tsc`. Scope (P70): a child has its parent's scope, or is
// projectless under a scoped parent (Settings ▸ Connections, This Mac: the instance's panes beside the project's); a scoped child
// under a projectless parent is refused, since the parent's address could not carry the project its child needs.
type Parent<R> = R extends { nav: { parent: string } } ? never : R extends { nav: { chord: string; phone: string } } ? R : never;
export type NavCheck<R> = R extends { nav: infer N }
  ? N extends { parent: infer P }
    ? P extends RouteId
      ? [Parent<(typeof ROUTE_TABLE)[P]>] extends [never]
        ? never
        : N extends { chord: string } | { phone: string }
          ? never
          : R extends { scoped: false }
            ? true
            : R extends { scoped: (typeof ROUTE_TABLE)[P]["scoped"] }
              ? true
              : never
      : never
    : [Parent<R>] extends [never] ? never : true
  : true;
export const NAV_SHAPE: { readonly [K in RouteId]: NavCheck<(typeof ROUTE_TABLE)[K]> } = {
  "overview.page": true,
  "mail.list": true,
  "mail.item": true,
  "mail.inbound": true,
  "mail.lead": true,
  "messengers.page": true,
  "messengers.settings": true,
  "log.list": true,
  "knowledge.page": true,
  "settings.page": true,
  "settings.checks": true,
  "settings.mail": true,
  "settings.agent": true,
  "settings.connections": true,
  "settings.mac": true,
  "help.page": true,
};

const ID = String.raw`[1-9]\d*`;
/** One project segment of a multi-project address: anything but a slash, a query or a fragment (the slug is URL-encoded). */
const SLUG = String.raw`[^/?#]+`;
const PAGE_ID = "[0-9a-f]{32}";
const escape = (p: string): string => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\[id\\]", () => ID).replace("\\[page\\]", () => PAGE_ID);

const isRouteId = (k: string): k is RouteId => k in ROUTE_TABLE;
export const ROUTE_IDS: readonly RouteId[] = Object.keys(ROUTE_TABLE).filter(isRouteId);
const rows: readonly Row[] = Object.values(ROUTE_TABLE);
const pattern = (r: Row): string => (r.scoped ? `(?:/${SLUG})?${escape(r.path)}` : escape(r.path));

/** Every page of the tree (both shapes of a scoped one) and the entry `/`, with an optional query: the run-time door `routeOf` accepts exactly these. */
export const PAGE = new RegExp(`^(/|${rows.map(pattern).join("|")})(\\?[^#]*)?$`);

/**
 * The routes about the whole instance: their address never names a project. A projectless child of a scoped parent (P70) also
 * has a page under `[project]/`, only so that `/<project>/settings/connections` renders inside the shell, where the guard folds
 * it to `/settings/connections` (`canonicalAddress`); `PAGE` does not accept that form, so nothing links it.
 */
export const PROJECTLESS: ReadonlySet<RouteId> = new Set(ROUTE_IDS.filter((id) => !ROUTE_TABLE[id].scoped));

/** The first path segments that are sections, not projects: a project with one of these names cannot be addressed by path. */
export const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([...rows.map((r) => r.path.split("/")[1] ?? ""), "health", "api"]);

/** The list route of a section: its parent row (with `nav` and no `parent`). */
export function listRouteOf(section: string): RouteId {
  const id = ROUTE_IDS.find((k) => {
    const r: Row = ROUTE_TABLE[k];
    return r.section === section && "nav" in r && !("parent" in r.nav);
  });
  if (!id) throw new Error(`no route for section ${section}`);
  return id;
}
