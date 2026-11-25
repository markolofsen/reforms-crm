import { useRef, useState } from "react";
import type { Mark, SettableStatus, Tone } from "@hub/config";
import { actionToast } from "@hub/ui/product/action-toast";
import { sentence } from "@/lib/api/client";
import { useClock } from "@/lib/clock";
import { useDraftCommands, useStopStepFollowUps } from "@/lib/data/drafts";
import { firstName, undoTarget, type ReviewDraft } from "@/features/mail/model";

export type Notice = { text: string; kind: "info" | "error" };

/** What a status change says, as a toast with Undo (a move back to ready is its own undo and says nothing). */
const STATUS_TOAST: Partial<Record<SettableStatus, (name: string) => string>> = { done: (n) => `Marked ${n} done`, skipped: (n) => `Skipped ${n}`, hold: (n) => `Held ${n}` };

/**
 * Everything a person does to a draft, as commands of `lib/data/drafts.ts` that share one settle rule: the touched topics are read
 * again on success and on failure (a 409 means they were stale), and a failure's sentence is shown.
 * `pending` is true while any write is in flight, so the controls disable instead of double-firing.
 */
export function useReviewActions(project: string) {
  const clock = useClock();
  const [notice, setNotice] = useState<Notice | null>(null);
  // P105: the review dialog of one open draft (Send, or Check for Send all Checked), opened by the card's Send, Shift+Enter or `C`.
  const [review, setReview] = useState<{ id: number; mode: "send" | "check" } | null>(null);
  // The draft last moved by Done, Skip or Hold, so `U` reaches it even after the card moved on to the next one.
  const last = useRef<{ draft: ReviewDraft; at: number } | null>(null);
  const onError = (e: unknown) => setNotice({ text: sentence(e), kind: "error" });
  const { checked, status, tone, undo, undoMany, marks } = useDraftCommands(project, onError);
  // P47: the owner stops a client's sequence from the step draft's card; the server skips the open step in the same write.
  const stop = useStopStepFollowUps<{ enrollmentId: number; name: string }>(project, {
    onSuccess: (_r, v) => setNotice({ text: `Sequence stopped for ${v.name}. The open step is skipped; nothing more is drafted.`, kind: "info" }),
    onError,
  });

  const undoNow = (d: ReviewDraft) => {
    setNotice(null);
    if (last.current?.draft.id === d.id) last.current = null;
    undo.mutate(d.id);
  };

  // A bulk move says one thing for all of them, so its Undo (`undoMany`) is one write per draft and one re-read at the end.
  const pending = [undoMany, checked, status, tone, undo, marks, stop].some((m) => m.isPending);
  return {
    notice,
    setNotice,
    pending,
    review,
    openReview: (d: ReviewDraft, mode: "send" | "check") => setReview({ id: d.id, mode }),
    closeReview: () => setReview(null),
    setChecked: (d: ReviewDraft, on: boolean, hash?: string | null) => {
      setNotice(null);
      checked.mutate({ id: d.id, checked: on, ...(hash ? { hash } : {}) });
    },
    /** One path for the button, the key and the bar: the toast with Undo is part of the action. `quiet` is for a batch that says one thing for all. */
    setStatus: (d: ReviewDraft, s: SettableStatus, opts: { reason?: string; quiet?: boolean } = {}) => {
      setNotice(null);
      status.mutate({ id: d.id, status: s, reason: opts.reason });
      const say = STATUS_TOAST[s];
      if (!say) return;
      last.current = { draft: d, at: clock() };
      if (!opts.quiet) actionToast({ title: say(firstName(d)), type: "success", action: { label: "Undo", run: () => undoNow(d) } });
    },
    setTone: (d: ReviewDraft, t: Tone) => tone.mutate({ id: d.id, tone: t }),
    undo: undoNow,
    /** The Undo of the bulk toast: every draft of the selection goes back where it was. */
    undoMany: (ds: ReviewDraft[]) => {
      setNotice(null);
      last.current = null;
      undoMany.mutate(ds.map((d) => d.id));
    },
    /** Key `U`: the draft last changed, else the open one (`undoTarget`). */
    undoKey: (open: ReviewDraft | null) => {
      const target = undoTarget(last.current, open, clock());
      if (target) undoNow(target);
    },
    setMarks: (clientId: number, next: Mark[]) => marks.mutate({ clientId, marks: next }),
    /** Stop the sequence (P47) for the client of a step draft. */
    stopFollowUps: (d: ReviewDraft) => {
      if (!d.sequence) return;
      setNotice(null);
      stop.mutate({ enrollmentId: d.sequence.enrollmentId, name: firstName(d) });
    },
  };
}

export type ReviewActions = ReturnType<typeof useReviewActions>;
