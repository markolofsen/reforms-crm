"use client";

import { useMemo } from "react";
import { dest, sectionList, type Dest } from "@/routes/paths";
import { childrenOf, SECTIONS, type IconKey, type SectionId } from "@/routes/sections";
import { ROUTE_TABLE } from "@/routes/table";
import type { RouteId } from "@/routes/table";
import { useHotkeys, type KeyMap } from "@hub/ui/use-hotkey";
import { shortcutsOn } from "./use-hotkeys";
import { useGo } from "./use-go";
import { useRoute } from "./use-route";

/**
 * A page drawn under its section (P63 N1): the section's landing first, named by its own title, then its child pages (P70:
 * Settings' Sending, Checks, Mail, Agent, Connections, This Mac), drawn in the sub-nav (P75). `active` is the page on screen.
 */
export type NavChild = { route: RouteId; title: string; to: Dest; active: boolean };
/** A section of the nav: `active` while any of its pages is on screen; `children` its child pages, in order. */
export type NavItem = { id: SectionId; route: RouteId; title: string; icon: IconKey; to: Dest; active: boolean; phone: "bar" | "more"; children: NavChild[] };

/** A section's pages under it: none for a section without children; else its landing, then the children in order. */
function pagesOf(landing: RouteId, id: SectionId, current: string): NavChild[] {
  const kids = childrenOf(id);
  if (kids.length === 0) return [];
  return [{ route: landing, title: ROUTE_TABLE[landing].title, to: sectionList(id), active: current === landing }, ...kids.map((c) => ({ route: c.route, title: c.title, to: dest(c.route), active: current === c.route }))];
}

const CHORD_HELP = SECTIONS.map((s) => [`${s.chord[0]} ${s.chord[1]}`.toUpperCase(), `go to ${s.title}`] as const);

/** The sections for the shell (every instance has every one, P63), with their destination, their child pages, which one is current, and the `g` chords. */
export function useSectionNav(): NavItem[] {
  const route = useRoute();
  const go = useGo();
  const keys = useMemo<KeyMap>(
    () => Object.fromEntries(SECTIONS.map((s) => [`${s.chord[0]} ${s.chord[1]}`, (e) => { e.preventDefault(); go(sectionList(s.id)); }])),
    [go],
  );
  useHotkeys(keys, shortcutsOn, CHORD_HELP, { capture: true });
  return SECTIONS.map((s) => ({
    id: s.id,
    route: s.route,
    title: s.title,
    icon: s.icon,
    to: sectionList(s.id),
    active: route.section === s.id,
    phone: s.phone,
    children: pagesOf(s.route, s.id, route.route),
  }));
}
