import type { ReviewDraftDto } from "@hub/contract/responses";

export type ReviewDraft = ReviewDraftDto;

/** One page of drafts to review, from either screen: recorded drafts (Drafts) or one batch (Bulk). */
export type ReviewPage = { drafts: ReviewDraft[]; total: number; nextOffset: number | null; counts: Partial<Record<string, number>> };

/** What the review screen needs from the screen that hosts it. It never learns which endpoint answered. */
export type ReviewSource = {
  /** Cache key: the drafts of this view, per filter. */
  queryKey: readonly unknown[];
  project: string;
  filter: string;
  /** The number a view shows next to its name, from the counts of the first page. */
  countOf: (counts: ReviewPage["counts"], view: string) => number | undefined;
  load: (offset: number) => Promise<ReviewPage>;
  /** A batch can step back its own last action (key U); recorded drafts undo the open draft only. */
  undoLast?: () => Promise<unknown>;
};

export const isClosed = (d: ReviewDraft) => d.status === "done" || d.status === "sent" || d.status === "skipped";
export const openResults = (d: ReviewDraft) => d.safetyResults.filter((r) => !r.acked);

export const SKIP_REASONS = ["Not interested", "Wrong person", "Already handled", "Not now"] as const;

export const firstName = (d: ReviewDraft): string => d.client.name.split(" ")[0] ?? d.client.name;

/** How long after Done, Skip or Hold the `U` key still undoes that draft. */
export const UNDO_WINDOW_MS = 30_000;

/**
 * The draft `U` undoes. Done and Skip move on to the next draft, so the open draft is NOT the one just changed: `last`
 * is, while it is recent. Otherwise the open draft, when the server says it can be undone.
 */
export function undoTarget(last: { draft: ReviewDraft; at: number } | null, open: ReviewDraft | null, now: number): ReviewDraft | null {
  if (last && now - last.at <= UNDO_WINDOW_MS) return last.draft;
  return open?.canUndo ? open : null;
}
