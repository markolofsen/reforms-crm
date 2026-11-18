"use client";

import { useMemo } from "react";
import { sectionList, type Dest } from "@/routes/paths";
import { navSections, type IconKey, type SectionId } from "@/routes/sections";
import { shortcutsOn, useHotkeys, type KeyMap } from "./use-hotkeys";
import { useGo } from "./use-go";
import { usePlace } from "./use-project";
import { useRoute } from "./use-route";

export type NavItem = { id: SectionId; title: string; icon: IconKey; to: Dest; active: boolean };

/** The sections for the shell (Overview only with several projects), with their destination and which one is current, and the `g d / g a / g p` chords. */
export function useSectionNav(): NavItem[] {
  const route = useRoute();
  const go = useGo();
  const { multi } = usePlace();
  const sections = useMemo(() => navSections(multi), [multi]);
  const keys = useMemo<KeyMap>(
    () => Object.fromEntries(sections.map((s) => [`${s.chord[0]} ${s.chord[1]}`, (e) => { e.preventDefault(); go(sectionList(s.id)); }])),
    [go, sections],
  );
  const help = useMemo(() => sections.map((s) => [`${s.chord[0]} ${s.chord[1]}`.toUpperCase(), `go to ${s.title}`] as const), [sections]);
  useHotkeys(keys, shortcutsOn, help, { capture: true });
  return sections.map((s) => ({ id: s.id, title: s.title, icon: s.icon, to: sectionList(s.id), active: route.section === s.id }));
}
