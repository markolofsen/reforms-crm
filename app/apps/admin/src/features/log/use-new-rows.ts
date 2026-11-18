import { useState } from "react";

type Seen = { view: string; ids: readonly number[] };

/**
 * "2 new" when sessions appear in the table after it first loaded (a live refetch, P50), for a polite live region:
 * it never moves focus or the scroll (`accessibility.md` rule 5). A new view (filter or project) starts over. `ids` must
 * keep its identity while the data does (a `useMemo` of the query data), since a new array is read as a new answer.
 */
export function useNewRows(view: string, ids: readonly number[] | undefined): string {
  const [seen, setSeen] = useState<Seen | null>(null);
  const [said, setSaid] = useState("");
  if (ids && (seen === null || seen.ids !== ids || seen.view !== view)) {
    // React's "adjust state when a prop changes" pattern: no effect, no extra paint.
    setSeen({ view, ids });
    const before = seen && seen.view === view ? new Set(seen.ids) : null;
    const fresh = before ? ids.filter((id) => !before.has(id)).length : 0;
    if (!before) setSaid("");
    else if (fresh > 0) setSaid(`${fresh} new`);
  }
  return said;
}
