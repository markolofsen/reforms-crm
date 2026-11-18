import { ROUTE_IDS, ROUTE_TABLE, type NavMeta } from "./table";

type WithNav = Extract<(typeof ROUTE_TABLE)[keyof typeof ROUTE_TABLE], { nav: NavMeta }>;
export type SectionId = WithNav["section"];
export type IconKey = WithNav["nav"]["icon"];

/** One top-level screen as the shell reads it: derived from the `nav` metadata of the route table, never declared twice. */
export type Section = { readonly id: SectionId; readonly title: string; readonly icon: IconKey; readonly order: number; readonly when: NavMeta["when"]; readonly chord: readonly ["g", string] };

const hasNav = (r: (typeof ROUTE_TABLE)[keyof typeof ROUTE_TABLE]): r is WithNav => "nav" in r;

/** The sections in nav order. The chords are `g` + the row's key (`g d`, `g a`, ...). */
export const SECTIONS: readonly Section[] = ROUTE_IDS.map((id) => ROUTE_TABLE[id])
  .filter(hasNav)
  .map((r) => ({ id: r.section, title: r.nav.label, icon: r.nav.icon, order: r.nav.order, when: r.nav.when, chord: ["g", r.nav.chord] as const }))
  .sort((a, b) => a.order - b.order);

/** The sections the nav shows: Overview only when the instance has two or more projects (P48). */
export const navSections = (multi: boolean): readonly Section[] => SECTIONS.filter((s) => s.when === "always" || multi);

export const sectionById = (id: SectionId): Section | undefined => SECTIONS.find((s) => s.id === id);
export const sectionTitle = (id: SectionId): string => sectionById(id)?.title ?? id;
