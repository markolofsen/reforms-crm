"use client";

import { createContext, useContext, useEffect, useState, type RefObject } from "react";
import { SPLIT_MIN_PX } from "@hub/ui/product/list-detail";

/**
 * Whether the screen's pane is too narrow for a list and its detail side by side. It follows the pane, not the viewport:
 * the docked terminal takes 400 to 60 % of the window, and the list-detail switches on its own width by a container query
 * (`@hub/ui/product/list-detail`, the same number). A screen that must know it in code (Drafts opens the first draft only when
 * both show) reads it here. False on the server and in the first render (state-and-data 11); the shell measures after mount.
 */
export const PaneNarrowContext = createContext<boolean | null>(null);
export const usePaneNarrow = (): boolean => useContext(PaneNarrowContext) === true;
/** Whether the pane has been measured: before that, nothing may act on its width (Drafts' auto-open would open a card on a phone). */
export const usePaneMeasured = (): boolean => useContext(PaneNarrowContext) !== null;

/** The shell's half: measures its content column and says whether it is narrower than the split (null until measured). */
export function useMeasuredNarrow(ref: RefObject<HTMLElement | null>): boolean | null {
  const [narrow, setNarrow] = useState<boolean | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setNarrow(entry.contentRect.width < SPLIT_MIN_PX));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return narrow;
}
