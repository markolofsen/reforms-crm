import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Mark, SafetyKind, SettableStatus, Tone } from "@hub/config";
import { refreshData, sentence } from "@/lib/api/client";
import { reviewApi } from "@/lib/api/review";
import type { ReviewDraft } from "./source";

export type Notice = { text: string; kind: "info" | "error" };

/**
 * Everything a person does to a draft, as mutations that share one settle rule: on success every list is read again,
 * on failure the server's sentence is shown (and the lists are read again too, because a 409 means they were stale).
 * `pending` is true while any write is in flight, so the controls disable instead of double-firing.
 */
export function useReviewActions(project: string) {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<Notice | null>(null);
  const settle = {
    onSuccess: () => refreshData(qc),
    onError: (e: unknown) => {
      setNotice({ text: sentence(e), kind: "error" });
      void refreshData(qc);
    },
  };
  const checked = useMutation({ mutationFn: (v: { id: number; checked: boolean; hash?: string }) => reviewApi.setChecked(project, v.id, v.checked, v.hash), ...settle });
  const status = useMutation({ mutationFn: (v: { id: number; status: SettableStatus; reason?: string }) => reviewApi.setStatus(project, v.id, v.status, v.reason), ...settle });
  const tone = useMutation({ mutationFn: (v: { id: number; tone: Tone }) => reviewApi.setTone(project, v.id, v.tone), ...settle });
  const ack = useMutation({ mutationFn: (v: { id: number; kind: SafetyKind; acked: boolean }) => reviewApi.ack(project, v.id, v.kind, v.acked), ...settle });
  const undo = useMutation({ mutationFn: (id: number) => reviewApi.undo(project, id), ...settle });
  const marks = useMutation({ mutationFn: (v: { clientId: number; marks: Mark[] }) => reviewApi.setMarks(project, v.clientId, v.marks), ...settle });

  const pending = [checked, status, tone, ack, undo, marks].some((m) => m.isPending);
  return {
    notice,
    setNotice,
    pending,
    setChecked: (d: ReviewDraft, on: boolean, hash?: string | null) => {
      setNotice(null);
      checked.mutate({ id: d.id, checked: on, ...(hash ? { hash } : {}) });
    },
    setStatus: (d: ReviewDraft, s: SettableStatus, reason?: string) => {
      setNotice(null);
      status.mutate({ id: d.id, status: s, reason });
    },
    setTone: (d: ReviewDraft, t: Tone) => tone.mutate({ id: d.id, tone: t }),
    acknowledge: (d: ReviewDraft, kind: SafetyKind, on: boolean) => ack.mutate({ id: d.id, kind, acked: on }),
    undo: (d: ReviewDraft) => {
      setNotice(null);
      undo.mutate(d.id);
    },
    setMarks: (clientId: number, next: Mark[]) => marks.mutate({ clientId, marks: next }),
  };
}

export type ReviewActions = ReturnType<typeof useReviewActions>;
