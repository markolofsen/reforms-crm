import { useCallback, useState } from "react";
import { refOf } from "@hub/contract/focus";
import { useFocusSelection, useFocusSubject } from "@/lib/focus";
import { isClosed, rowId, type ConversationRow, type ReviewDraft } from "@/features/mail/model";

/**
 * The people picked for a bulk action (P99: selection is over conversations, `x` selects the client; Skip and Hold act on each
 * one's open draft): separate from the open row (picking never opens a conversation, opening never picks). `selecting` is on
 * while any row is picked or the person pressed Select (touch has no hover to start from).
 */
export function useSelection(rows: ConversationRow[]) {
  const [ids, setIds] = useState<ReadonlySet<number>>(new Set());
  const [mode, setMode] = useState(false);
  // Rows that left the list (a filter, an action) leave the selection too.
  const picked = rows.filter((r) => ids.has(rowId(r)));
  const toggle = useCallback((id: number) => setIds((prev) => (prev.has(id) ? new Set([...prev].filter((x) => x !== id)) : new Set([...prev, id]))), []);
  const clear = useCallback(() => {
    setIds(new Set());
    setMode(false);
  }, []);
  const all = useCallback(() => setIds(new Set(rows.filter((r) => r.draft !== null && !isClosed(r.draft)).map(rowId))), [rows]);
  /** The open drafts of the picked people: what Skip and Hold act on. */
  const drafts: ReviewDraft[] = picked.flatMap((r) => (r.draft && !isClosed(r.draft) ? [r.draft] : []));
  return { all, picked, drafts, has: (id: number) => ids.has(id), toggle, clear, selecting: mode || picked.length > 0, setMode };
}

/**
 * P51, P72, P99: the conversation on screen and the picked people, shared with the focus publisher through the screens' channel
 * (`lib/focus.ts`), because the address does not say the picked rows (and a wide pane opens the first row of a bare `/mail`). The
 * subject is `client:<id>`; the agent's resolver names its open draft and their newest message. Cleared when the list leaves.
 */
export function useShareReview(shown: ConversationRow | null, picked: readonly ConversationRow[]): void {
  useFocusSubject(shown ? refOf("client", rowId(shown)) : null, shown ? shown.client.name || shown.client.email : "");
  useFocusSelection(picked.map((r) => refOf("client", rowId(r))));
}
