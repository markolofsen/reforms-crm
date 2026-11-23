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

/** P128 X4: a batch leaves the View menu this many days after its last draft was sent or done, once nothing in it is open. */
export const BATCH_KEEP_DAYS = 7;
const BATCH_SHORT_MAX = 28;

/** Whether the View menu still lists a batch: one with an open draft, a closed one for 7 days after its last send or done, or the one on screen. */
export function batchListed(b: { id: number; lastClosedAt: string | null; counts: { review: number; checked: number; hold: number } }, now: number, onScreen: number | null): boolean {
  if (b.id === onScreen) return true;
  if (b.counts.review + b.counts.checked + b.counts.hold > 0 || b.lastClosedAt === null) return true;
  return now - Date.parse(b.lastClosedAt) < BATCH_KEEP_DAYS * 86_400_000;
}

/** The batch chip's short name (P128 X4): the name cut at a word to 28 characters; the asking prompt stays its "Asked for" line. */
export function shortBatchName(name: string): string {
  const t = name.replace(/\s+/g, " ").trim();
  if (t.length <= BATCH_SHORT_MAX) return t;
  const cut = t.slice(0, BATCH_SHORT_MAX - 1);
  // A cut that ends exactly at a word keeps that word; otherwise it goes back to the last space.
  const space = t[cut.length] === " " ? cut.length : cut.lastIndexOf(" ");
  return `${(space > 12 ? cut.slice(0, space) : cut).replace(/[\s,.;:·-]+$/, "")}…`;
}
