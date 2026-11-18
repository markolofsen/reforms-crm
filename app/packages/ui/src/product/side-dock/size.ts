// The width rules of the side dock, pure so a unit test holds them (`packages/ui/test/side-dock.test.ts`). The dock sits on
// the right and its separator on its start edge, so moving the separator left (ArrowLeft, a drag to the left) widens it.

export const DOCK_WIDTH = {
  /** About 70 columns of 13px monospace: room for Claude Code's frame. */
  default: 560,
  min: 400,
  /** The share of the viewport the dock may take; the screen keeps the rest. */
  maxShare: 0.6,
  /** One ArrowLeft or ArrowRight. */
  step: 24,
} as const;

/** The widest the dock may be in a viewport this wide. An unknown viewport (0, before mount) sets no upper bound. */
export function maxWidth(viewport: number): number {
  if (!(viewport > 0)) return Number.POSITIVE_INFINITY;
  return Math.max(DOCK_WIDTH.min, Math.floor(viewport * DOCK_WIDTH.maxShare));
}

/** The width drawn for a wanted width: whole pixels, never under the minimum or over the viewport's share. */
export function clampWidth(wanted: number, viewport: number): number {
  const w = Number.isFinite(wanted) ? Math.round(wanted) : DOCK_WIDTH.default;
  return Math.min(maxWidth(viewport), Math.max(DOCK_WIDTH.min, w));
}

/** A saved width as text (`localStorage`) back to a number; anything unreadable is the default. */
export function parseWidth(saved: string | null): number {
  const n = saved === null ? Number.NaN : Number.parseInt(saved, 10);
  return Number.isFinite(n) && n > 0 ? n : DOCK_WIDTH.default;
}

/** The width after a key on the separator, or null when the key is not one of its keys. */
export function keyWidth(key: string, current: number, viewport: number): number | null {
  if (key === "ArrowLeft") return clampWidth(current + DOCK_WIDTH.step, viewport);
  if (key === "ArrowRight") return clampWidth(current - DOCK_WIDTH.step, viewport);
  if (key === "Home") return clampWidth(DOCK_WIDTH.default, viewport);
  return null;
}

/** The width while the separator is dragged from `startX` (where the pointer went down) to `x`. */
export const dragWidth = (startWidth: number, startX: number, x: number, viewport: number): number => clampWidth(startWidth + (startX - x), viewport);
