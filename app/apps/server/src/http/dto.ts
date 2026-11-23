import { BATCH_SEND_ACTOR } from "@hub/config";
import type { ReviewDraft, SendRow } from "@hub/db";

/** A draft's live send: the one that is queued, in progress or sent (a failed or cancelled one leaves the draft sendable). */
export const sendStateOf = (rows: SendRow[]) => {
  const r = rows.find((x) => x.status === "queued" || x.status === "sending" || x.status === "sent");
  // P87 (B4): how it went, for the sent card's line "Sent 20 Nov, 20:06 · Batch".
  const via = r?.actor === BATCH_SEND_ACTOR ? ("batch" as const) : r?.mode === "auto" ? ("auto" as const) : ("manual" as const);
  return r && (r.status === "queued" || r.status === "sending" || r.status === "sent") ? { id: r.id, status: r.status, dueAt: r.dueAt, via, doneAt: r.doneAt } : null;
};

/** The review shape plus what the screen needs and the row does not state: `canUndo` and the live send. The contract parse drops the rest. */
export const toDraft = (d: ReviewDraft, send: SendRow[] = []) => ({ ...d, canUndo: d.prevStatus != null, sendState: sendStateOf(send) });
