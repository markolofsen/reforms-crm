"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { FocusPost } from "@hub/contract/focus";
import type { LivePointer, PointerOutcome } from "@hub/contract/pointer";

// What the screen shows that the address does not say (P51, P72 decision 0038), as refs (`<kind>:<id>`, `@hub/contract/focus`):
// - `subject`: the record a screen opened that its address does not name (the Mail card the desktop opens on a bare
//   `/mail`), written by `useFocusSubject` (below);
// - `selected`: the picked rows (selection is not URL state), written by `useFocusSelection`;
// - `pointed` and `window`: the row he is on and the rows on screen, written by the `#main` observers (`features/focus`);
// - `pointer`: the outcome of the agent's last highlight, posted once; `away`: its refs that are not on this screen, for the dock;
// - `published`: the last focus this tab sent, so the dock header shows what the agent will see.
// Every label stays in the browser: only refs are posted. Module state: one per tab, never stored.

export type FocusLabel = { ref: string; label: string };
type Shared = {
  subject: FocusLabel | null;
  selected: readonly string[];
  pointed: FocusLabel | null;
  window: { refs: readonly string[]; total: number } | null;
  pointer: { id: string; outcome: PointerOutcome } | null;
  away: LivePointer | null;
  published: FocusPost | null;
};
const EMPTY: Shared = { subject: null, selected: [], pointed: null, window: null, pointer: null, away: null, published: null };
let state: Shared = EMPTY;
const listeners = new Set<() => void>();

function set(next: Partial<Shared>): void {
  const merged = { ...state, ...next };
  // Small values: a JSON comparison keeps an unchanged write from re-rendering every reader.
  if (JSON.stringify(merged) === JSON.stringify(state)) return;
  state = merged;
  listeners.forEach((cb) => cb());
}
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

/** The attribute a row carries so the observers, the focus and the agent's pointer find it: `<tr {...agentRef("draft:42")}>`. */
export const agentRef = (ref: string): { "data-agent-ref": string } => ({ "data-agent-ref": ref });
export const AGENT_REF_ATTR = "data-agent-ref";
export const CONVERSATION_LIST_FOCUS_SLOT = "conversation-list-focus";

export function focusAgentRow(ref: string): void {
  const escapedRef = globalThis.CSS?.escape?.(ref) ?? ref;
  document.querySelector<HTMLElement>(`[${AGENT_REF_ATTR}="${escapedRef}"] [data-slot="${CONVERSATION_LIST_FOCUS_SLOT}"]`)?.focus();
}

export const shareSubject = (subject: FocusLabel | null): void => set({ subject });
export const shareSelection = (selected: readonly string[]): void => set({ selected });
export const sharePointed = (pointed: FocusLabel | null): void => set({ pointed });
export const shareWindow = (window: Shared["window"]): void => set({ window });
export const sharePointerOutcome = (pointer: Shared["pointer"]): void => set({ pointer });
export const shareAway = (away: LivePointer | null): void => set({ away });
export const sharePublished = (published: FocusPost | null): void => set({ published });

export const useSharedFocus = (): Shared => useSyncExternalStore(subscribe, () => state, () => EMPTY);

/**
 * The dock header's line (P51, P72): the screen's title as the route table says it, then what "this" means to the agent (the
 * open record, else the row he is on, by the words he reads on it), then the selection. Before the first post: nothing current.
 */
export function agentSeesLine(published: FocusPost | null, labels: Pick<Shared, "subject" | "pointed">): string {
  if (!published) return "Agent sees: nothing current";
  const label = (published.subject && labels.subject?.ref === published.subject ? labels.subject.label : null) ?? (published.pointed && labels.pointed?.ref === published.pointed ? labels.pointed.label : null);
  return `Agent sees: ${published.title}${label ? ` · ${label}` : ""}${published.selected.length ? ` · ${published.selected.length} selected` : ""}`;
}

/**
 * P72 (decision 0038): the channel every screen uses to tell the agent what it shows beyond the address. A screen that opens
 * a record its address does not name calls `useFocusSubject(ref, label)` (the label is the words he reads, kept in the
 * browser: only the ref is posted); a screen with picked rows calls `useFocusSelection(refs)`. Both clear when the screen
 * leaves. Its rows carry `agentRef(ref)` (above); nothing else is needed for the agent to see them.
 */
export function useFocusSubject(ref: string | null, label: string): void {
  useEffect(() => shareSubject(ref ? { ref, label } : null), [ref, label]);
  useEffect(() => () => shareSubject(null), []);
}

export function useFocusSelection(refs: readonly string[]): void {
  const joined = refs.join("\n");
  useEffect(() => shareSelection(joined ? joined.split("\n") : []), [joined]);
  useEffect(() => () => shareSelection([]), []);
}
