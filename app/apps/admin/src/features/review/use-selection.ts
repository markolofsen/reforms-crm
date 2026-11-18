import { useCallback, useEffect, useState } from "react";
import { shareReview } from "@/lib/focus";
import { isClosed, type ReviewDraft } from "./source";

/**
 * The rows picked for a bulk action: separate from the open row (picking never opens a card, opening never picks).
 * `selecting` is on while any row is picked or the person pressed Select (touch has no hover to start from).
 */
export function useSelection(rows: ReviewDraft[]) {
  const [ids, setIds] = useState<ReadonlySet<number>>(new Set());
  const [mode, setMode] = useState(false);
  // Rows that left the list (a filter, an action) leave the selection too.
  const picked = rows.filter((r) => ids.has(r.id));
  const toggle = useCallback((id: number) => setIds((prev) => (prev.has(id) ? new Set([...prev].filter((x) => x !== id)) : new Set([...prev, id]))), []);
  const clear = useCallback(() => {
    setIds(new Set());
    setMode(false);
  }, []);
  const all = useCallback(() => setIds(new Set(rows.filter((r) => !isClosed(r)).map((r) => r.id))), [rows]);
  return { all, picked, has: (id: number) => ids.has(id), toggle, clear, selecting: mode || picked.length > 0, setMode };
}

/**
 * P51: the card on screen and the picked rows, shared with the focus publisher, because the address says neither (the desktop
 * opens the first row of a bare `/drafts`; selection is not URL state). Cleared when the list leaves the screen.
 */
export function useShareReview(shownId: number | null, picked: readonly ReviewDraft[]): void {
  const ids = picked.map((r) => r.id).join(",");
  useEffect(() => shareReview(shownId, ids ? ids.split(",").map(Number) : []), [shownId, ids]);
  useEffect(() => () => shareReview(null, []), []);
}
