import { useState } from "react";
import type { ReviewDraft } from "../source";

/** The words of a draft the agent can change: what a person reads before Send. A status, tone or tick is the owner's own. */
const textOf = (d: ReviewDraft) => JSON.stringify([d.subject, d.toAddr, d.ccAddr, d.body, d.toneBodies]);

/**
 * Whether the open draft's text changed under the card since the person opened it (a live refetch after the agent
 * re-recorded it, P50). The card then says so with Reload, which reads Mail again; it never swaps the text silently.
 * The send still compares the text's hash at send, so this is a courtesy, not the guard. The card is keyed by the draft
 * id, so the first text is the one this draft opened with.
 */
export function useChangedUnder(d: ReviewDraft): { changed: boolean; seen: () => void } {
  const text = textOf(d);
  const [base, setBase] = useState(text);
  return { changed: base !== text, seen: () => setBase(text) };
}
