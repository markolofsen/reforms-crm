// The pure half of the spotlight (P72): which elements a ref names, whether one can be seen, and whether a scroll would take
// the owner's place. No React: tested in node.

export type SpotlightOutcome = "shown" | "not-on-screen" | "dismissed" | "expired";

/** How long the ring waits for its rows to be visible before it reports `not-on-screen` (djangocfg `wait-for-visible`). */
export const SPOTLIGHT_WAIT_MS = 800;

/** The selector of one ref, as an attribute selector with the value escaped for a CSS string. */
export function refSelector(attribute: string, ref: string): string {
  return `[${attribute}="${ref.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
}

/** A box that has a size: an element hidden by `display: none` (the other width's twin row) has none. */
export const hasBox = (r: { width: number; height: number }): boolean => r.width > 0 && r.height > 0;

/** True while he is typing: a scroll then would take his place (a field, a select, an editable region, the terminal's input). */
export function isTyping(active: { tagName: string; isContentEditable?: boolean } | null): boolean {
  if (!active) return false;
  const tag = active.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || active.isContentEditable === true;
}

/** The polite announcement of a drawn pointer. */
export function announcement(shown: number, note: string | null): string {
  return `Agent points at ${shown === 1 ? "a row" : `${shown} rows`}${note ? `: ${note}` : ""}`;
}
