import type { ConversationRowDto } from "@hub/contract/conversations";
import type { ReviewDraftDto } from "@hub/contract/review";

export type ReviewDraft = ReviewDraftDto;
/** P99: a row of Mail is a person (a client), with its state word and at most one open draft, the unsent message. */
export type ConversationRow = ConversationRowDto;
export const rowId = (r: ConversationRow): number => r.client.id;

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
