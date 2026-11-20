import type { StatusNext } from "@hub/contract/overview";
import { ROUTE_IDS, ROUTE_TABLE, type NavMeta, type RouteId } from "./table";

type AnyRow = (typeof ROUTE_TABLE)[RouteId];
type WithNav = Extract<AnyRow, { nav: NavMeta }>;
type ParentRow = Exclude<WithNav, { nav: { parent: string } }>;
export type SectionId = ParentRow["section"];
export type IconKey = WithNav["nav"]["icon"];
/** A parent's child pages (P63 N1): Settings' Checks (P75), Mail, Agent, Connections and This Mac (P70). */
export type ChildRouteId = { [K in RouteId]: (typeof ROUTE_TABLE)[K] extends { nav: { parent: string } } ? K : never }[RouteId];

/** One top-level screen as the shell reads it: derived from the `nav` metadata of the route table, never declared twice. */
export type Section = { readonly id: SectionId; readonly route: RouteId; readonly title: string; readonly icon: IconKey; readonly order: number; readonly phone: "bar" | "more"; readonly chord: readonly ["g", string] };
/** One child page: drawn in the sub-nav of the parent's pages (P75: the sidebar draws parents only). */
export type Child = { readonly route: ChildRouteId; readonly title: string; readonly icon: IconKey; readonly order: number };

const hasNav = (r: AnyRow): r is WithNav => "nav" in r;
const isParent = (r: WithNav): r is ParentRow => !("parent" in r.nav);
const isChild = (id: RouteId): id is ChildRouteId => {
  const r: AnyRow = ROUTE_TABLE[id];
  return hasNav(r) && !isParent(r);
};

/** The sections in nav order: the parent rows. The chords are `g` + the row's key (`g d`, `g a`, ...); `NAV_SHAPE` in `table.ts` makes both present. */
export const SECTIONS: readonly Section[] = ROUTE_IDS.flatMap((id) => {
  const r: AnyRow = ROUTE_TABLE[id];
  if (!hasNav(r) || !isParent(r)) return [];
  return [{ id: r.section, route: id, title: r.nav.label, icon: r.nav.icon, order: r.nav.order, phone: r.nav.phone, chord: ["g", r.nav.chord] as const }];
}).sort((a, b) => a.order - b.order);

/** A section's child pages in order (empty for a section with none). The landing is the parent row itself, not a child. */
export function childrenOf(id: SectionId): readonly Child[] {
  return ROUTE_IDS.filter(isChild)
    .flatMap((route) => {
      const r = ROUTE_TABLE[route];
      return r.section === id ? [{ route, title: r.nav.label, icon: r.nav.icon, order: r.nav.order }] : [];
    })
    .sort((a, b) => a.order - b.order);
}

export const sectionById = (id: SectionId): Section | undefined => SECTIONS.find((s) => s.id === id);
export const sectionTitle = (id: SectionId): string => sectionById(id)?.title ?? id;

/**
 * The page each place of `statusDto.next` is fixed on (the server names a place, never a URL). Total over the contract's union,
 * so a new place fails `tsc` here. A child's dot also lights its parent, and a parent in the phone's More lights More.
 */
export const NEXT_ROUTE: Readonly<Record<StatusNext, Exclude<RouteId, "drafts.item">>> = {
  overview: "overview.page",
  knowledge: "knowledge.page",
  sending: "settings.page",
  mail: "settings.mail",
  agent: "settings.agent",
  connections: "settings.connections",
  mac: "settings.mac",
  messengers: "messengers.settings",
};
