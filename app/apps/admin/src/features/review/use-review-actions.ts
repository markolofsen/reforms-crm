import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { Mark, SafetyKind, SettableStatus, Tone } from "@hub/config";
import { toastManager } from "@hub/ui/toast";
import { refreshData, sentence } from "@/lib/api/client";
import { useClock } from "@/lib/clock";
import { reviewApi } from "@/lib/api/review";
import { firstName, undoTarget, type ReviewDraft } from "./source";

export type Notice = { text: string; kind: "info" | "error" };

/** What a status change says, as a toast with Undo (a move back to ready is its own undo and says nothing). */
const STATUS_TOAST: Partial<Record<SettableStatus, (name: string) => string>> = { done: (n) => `Marked ${n} done`, skipped: (n) => `Skipped ${n}`, hold: (n) => `Held ${n}` };

/**
 * Everything a person does to a draft, as mutations that share one settle rule: on success every list is read again,
 * on failure the server's sentence is shown (and the lists are read again too, because a 409 means they were stale).
 * `pending` is true while any write is in flight, so the controls disable instead of double-firing.
 */
export function useReviewActions(project: string) {
  const qc = useQueryClient();
  const clock = useClock();
  const [notice, setNotice] = useState<Notice | null>(null);
  // The draft last moved by Done, Skip or Hold, so `U` reaches it even after the card moved on to the next one.
  const last = useRef<{ draft: ReviewDraft; at: number } | null>(null);
  const settle = (mail: boolean) => ({
    onSuccess: () => refreshData(qc, { mail }),
    onError: (e: unknown) => {
      setNotice({ text: sentence(e), kind: "error" });
      void refreshData(qc, { mail });
    },
  });
  const checked = useMutation({ mutationFn: (v: { id: number; checked: boolean; hash?: string }) => reviewApi.setChecked(project, v.id, v.checked, v.hash), ...settle(false) });
  const status = useMutation({ mutationFn: (v: { id: number; status: SettableStatus; reason?: string }) => reviewApi.setStatus(project, v.id, v.status, v.reason), ...settle(true) });
  const tone = useMutation({ mutationFn: (v: { id: number; tone: Tone }) => reviewApi.setTone(project, v.id, v.tone), ...settle(false) });
  const ack = useMutation({ mutationFn: (v: { id: number; kind: SafetyKind; acked: boolean }) => reviewApi.ack(project, v.id, v.kind, v.acked), ...settle(true) });
  const undo = useMutation({ mutationFn: (id: number) => reviewApi.undo(project, id), ...settle(true) });
  const marks = useMutation({ mutationFn: (v: { clientId: number; marks: Mark[] }) => reviewApi.setMarks(project, v.clientId, v.marks), ...settle(false) });

  const undoNow = (d: ReviewDraft) => {
    setNotice(null);
    if (last.current?.draft.id === d.id) last.current = null;
    undo.mutate(d.id);
  };

  // A bulk move says one thing for all of them, so its Undo is one write per draft and one re-read at the end.
  const undoMany = useMutation({ mutationFn: (ids: number[]) => Promise.all(ids.map((id) => reviewApi.undo(project, id))), ...settle(true) });

  const pending = [undoMany, checked, status, tone, ack, undo, marks].some((m) => m.isPending);
  return {
    notice,
    setNotice,
    pending,
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
      if (!opts.quiet) toastManager.add({ title: say(firstName(d)), type: "success", actionProps: { children: "Undo", onClick: () => undoNow(d) } });
    },
    setTone: (d: ReviewDraft, t: Tone) => tone.mutate({ id: d.id, tone: t }),
    acknowledge: (d: ReviewDraft, kind: SafetyKind, on: boolean) => ack.mutate({ id: d.id, kind, acked: on }),
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
  };
}

export type ReviewActions = ReturnType<typeof useReviewActions>;
