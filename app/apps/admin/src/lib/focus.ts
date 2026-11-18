"use client";

import { useSyncExternalStore } from "react";
import type { FocusPost } from "@hub/contract/focus";

// What the screen shows that the address does not say (P51): the draft card open on the Drafts list (the desktop opens the
// first row without an id in the address) and the picked rows (P48: selection is not URL state). The review workspace writes
// it; the focus publisher (`features/focus`) and the terminal header read it. Plus the last focus this tab published, so the
// dock header shows what the agent will see. Module state: one per tab, never stored.

type Shared = { openDraftId: number | null; selected: readonly number[]; published: FocusPost | null };
let state: Shared = { openDraftId: null, selected: [], published: null };
const listeners = new Set<() => void>();
const SERVER: Shared = { openDraftId: null, selected: [], published: null };

function set(next: Partial<Shared>): void {
  const merged = { ...state, ...next };
  if (merged.openDraftId === state.openDraftId && merged.published === state.published && merged.selected.length === state.selected.length && merged.selected.every((id, i) => id === state.selected[i])) return;
  state = merged;
  listeners.forEach((cb) => cb());
}
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

/** The review workspace: the card it shows and the rows picked (in list order). */
export const shareReview = (openDraftId: number | null, selected: readonly number[]): void => set({ openDraftId, selected });
/** The publisher: what it last sent. */
export const sharePublished = (published: FocusPost | null): void => set({ published });

export const useSharedFocus = (): Shared => useSyncExternalStore(subscribe, () => state, () => SERVER);
