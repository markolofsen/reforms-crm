import { BATCH_FILTERS } from "@hub/config";
import { DRAFT_VIEWS, RUN_FILTERS } from "./search";

/** One top-level screen, as data. The nav, the key chords, the titles and the shell derive from this list. */
export type SectionMeta = {
  readonly id: string;
  readonly title: string;
  /** False keeps a section reachable by address but out of the nav. */
  readonly nav: boolean;
  /** Icon key (resolved to an icon by the shell, never imported here). */
  readonly icon: string;
  /** Two-key chord: `g` then the second key. */
  readonly chord: readonly [string, string];
  readonly filters: readonly string[];
};

export const SECTIONS = [
  // Cross-project: the only section whose address carries no `?project=` (`routes-and-url-state.md` rule 8, exemption).
  { id: "overview", title: "Overview", nav: true, icon: "overview", chord: ["g", "o"], filters: [] },
  { id: "drafts", title: "Drafts", nav: true, icon: "inbox", chord: ["g", "d"], filters: DRAFT_VIEWS },
  { id: "bulk", title: "Bulk", nav: true, icon: "send", chord: ["g", "b"], filters: BATCH_FILTERS },
  { id: "log", title: "Activity", nav: true, icon: "activity", chord: ["g", "a"], filters: RUN_FILTERS },
  { id: "project", title: "Project", nav: true, icon: "settings", chord: ["g", "p"], filters: [] },
] as const satisfies readonly SectionMeta[];

export type SectionId = (typeof SECTIONS)[number]["id"];

export const sectionById = (id: SectionId) => SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
export const sectionTitle = (id: SectionId): string => sectionById(id).title;
