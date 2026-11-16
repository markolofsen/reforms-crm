"use client";

import { useMemo } from "react";
import { sectionList, type Dest } from "@/routes/paths";
import { SECTIONS, type SectionId } from "@/routes/sections";
import { shortcutsOn, useHotkeys, type KeyMap } from "./use-hotkeys";
import { useGo } from "./use-go";
import { useRoute } from "./use-route";

export type NavItem = { id: SectionId; title: string; icon: string; to: Dest; active: boolean };

const HELP = SECTIONS.map((s) => [`${s.chord[0]} ${s.chord[1]}`.toUpperCase(), `go to ${s.title}`] as const);

/** The sections for the shell, with their destination and which one is current, and the `g d / g b / g a / g p` chords. */
export function useSectionNav(): NavItem[] {
  const route = useRoute();
  const go = useGo();
  const keys = useMemo<KeyMap>(
    () => Object.fromEntries(SECTIONS.map((s) => [`${s.chord[0]} ${s.chord[1]}`, (e) => { e.preventDefault(); go(sectionList(s.id)); }])),
    [go],
  );
  useHotkeys(keys, shortcutsOn, HELP, { capture: true });
  return SECTIONS.filter((s) => s.nav).map((s) => ({ id: s.id, title: s.title, icon: s.icon, to: sectionList(s.id), active: route.section === s.id }));
}
