import { useCallback, useState } from "react";
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
