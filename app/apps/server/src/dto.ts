import type { ReviewDraft, SendRow } from "@hub/db";

/** A draft's live send: the one that is queued, in progress or sent (a failed or cancelled one leaves the draft sendable). */
export const sendStateOf = (rows: SendRow[]) => {
  const r = rows.find((x) => x.status === "queued" || x.status === "sending" || x.status === "sent");
  return r && (r.status === "queued" || r.status === "sending" || r.status === "sent") ? { id: r.id, status: r.status, dueAt: r.dueAt } : null;
};

/** The review shape plus what the screen needs and the row does not state: `canUndo` and the live send. The contract parse drops the rest. */
export const toDraft = (d: ReviewDraft, send: SendRow[] = []) => ({ ...d, canUndo: d.prevStatus != null, sendState: sendStateOf(send) });
