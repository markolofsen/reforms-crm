"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { Mark, SafetyKind, SettableStatus, Tone } from "@hub/config";
import type { LiveTopic } from "@hub/contract/live";
import type { DraftMailDto } from "@hub/contract/mail";
import type { BatchRunDto, BatchSendPlanDto, SendPreviewDto } from "@hub/contract/sending";
import { reviewApi } from "@/lib/api/review";
import { batchSendApi, sendApi } from "@/lib/api/send";
import { sequencesApi } from "@/lib/api/inbox";
import { keys } from "@/lib/cache/keys";
import { useCommand, useRefreshTopics } from "@/lib/cache/topics";
import { useSendDoor } from "./send-door";

/**
 * P127 C2's data half (V3): Mail's drafts, one module (state rule 4b): the draft's writes (Checked, status, tone, Undo, marks, Stop
 * follow-ups), its Mail text read and written (Save, Restore, Tidy), the owner's manual draft, the send preview and send through
 * the one door, Cancel of a queued send, and a batch's Send all Checked. Nothing here sends on its own: every send is the owner's
 * click on a dialog that showed what goes (decision 0011). Features never name a key, a facade or the Query client.
 */

/** A draft's own row: Mail's people, the batch, the timeline, the project, Overview, the Inbox (`drafts`). */
const DRAFT: readonly LiveTopic[] = ["drafts"];
/** A write that changes the Mail draft too (status, Undo, a send, Save and Restore): the card reads Mail again. */
const DRAFT_MAIL: readonly LiveTopic[] = ["drafts", "mail"];
/** A send moved: the sends, the batch's run, the drafts and the history, and Mail. */
const SEND: readonly LiveTopic[] = ["sends", "mail"];

// ---- The draft's writes (`features/mail/list/use-review-actions.ts` keeps the notice, the toasts and `U`'s target)

/**
 * Everything a person does to a draft, as commands that share one settle rule: the touched topics are read again on success and on
 * failure (a 409 means the lists were stale). `onError` says the server's sentence.
 */
export function useDraftCommands(project: string, onError: (e: unknown) => void) {
  const on = { project, onError };
  return {
    checked: useCommand({ ...on, touches: DRAFT, run: (v: { id: number; checked: boolean; hash?: string }) => reviewApi.setChecked(project, v.id, v.checked, v.hash) }),
    status: useCommand({ ...on, touches: DRAFT_MAIL, run: (v: { id: number; status: SettableStatus; reason?: string }) => reviewApi.setStatus(project, v.id, v.status, v.reason) }),
    tone: useCommand({ ...on, touches: DRAFT, run: (v: { id: number; tone: Tone }) => reviewApi.setTone(project, v.id, v.tone) }),
    undo: useCommand({ ...on, touches: DRAFT_MAIL, run: (id: number) => reviewApi.undo(project, id) }),
    /** A bulk move's Undo: one write per draft and one re-read at the end. */
    undoMany: useCommand({ ...on, touches: DRAFT_MAIL, run: (ids: number[]) => Promise.all(ids.map((id) => reviewApi.undo(project, id))) }),
    marks: useCommand({ ...on, touches: ["clients"], run: (v: { clientId: number; marks: Mark[] }) => reviewApi.setMarks(project, v.clientId, v.marks) }),
  };
}

/** P47: the owner stops a client's sequence from the step draft's card; the server skips the open step in the same write. */
export const useStopStepFollowUps = <V extends { enrollmentId: number }>(project: string, on: { onSuccess: (r: unknown, v: V) => void; onError: (e: unknown) => void }) =>
  useCommand({ project, touches: ["sequences", "drafts", "mail"], run: (v: V) => sequencesApi.stop(project, v.enrollmentId), onSuccess: on.onSuccess, onError: on.onError });

/**
 * P105: the review dialog's acknowledgements and Checked: acknowledge what the dialog listed, then tick Checked on the very text
 * that was read (the server refuses a stale hash); `tick` false when the draft is already Checked on this text. `check` is the
 * dialog's Check (for Send all Checked); `consent` is the same writes run before a Send's dry run (the door's `before`).
 */
export function useCheckDraft(project: string, draftId: number, onSuccess: () => void) {
  const consent = async (o: { hash: string; listed: readonly { kind: SafetyKind }[]; tick: boolean }) => {
    for (const r of o.listed) await reviewApi.ack(project, draftId, r.kind, true);
    if (o.tick) await reviewApi.setChecked(project, draftId, true, o.hash);
  };
  const check = useCommand({ project, touches: DRAFT, run: consent, onSuccess });
  return { check, consent };
}

/** The owner's manual reply: one unsent Mail draft, never sent. The conversation reads Mail again to show it. */
export const useManualDraft = (project: string, clientId: number, brand: string | null, onSuccess: () => void) =>
  useCommand({ project, touches: DRAFT_MAIL, run: (text: string) => reviewApi.createManualDraft(project, clientId, text, brand), onSuccess });

// ---- The draft's Mail text (decision 0013: read on demand, never stored)

/**
 * The draft as Mail holds it right now (P27 M2): read on demand when the card is open, never stored. Re-read when the window
 * regains focus, so a text edited in Mail shows up before Checked or Send, and the answer carries the hash Checked binds to.
 */
export const useDraftMail = (project: string, draftId: number, enabled: boolean) =>
  useQuery({ queryKey: keys.draftMail(project, draftId), queryFn: () => sendApi.mail(project, draftId), enabled, staleTime: 0, refetchOnWindowFocus: true });

/** The last Mail read of a draft, as the card holds it (the `C` key judges the tick on it without reading Mail again). */
export function useDraftMailOf(project: string): (draftId: number) => DraftMailDto | undefined {
  const qc = useQueryClient();
  return (draftId) => qc.getQueryData<DraftMailDto>(keys.draftMail(project, draftId));
}

/**
 * The two writes a person makes to a draft's Mail text (P56): Save (the edited text, over the read whose hash it carries) and
 * Restore (the Hub's last copy, back from Trash). Both go through the server's one writer, which turns Checked off. On success the
 * card shows the saved text at once, with no hash (so it cannot be Checked until Mail is read back), and Mail is read again; the
 * row and the list refresh with it.
 */
export function useMailWrite(project: string, draftId: number) {
  const qc = useQueryClient();
  const save = useCommand({
    project,
    touches: DRAFT_MAIL,
    run: (v: { text: string; hash: string }) => sendApi.save(project, draftId, v.text, v.hash),
    onSuccess: (_r, v) => qc.setQueryData<DraftMailDto>(keys.draftMail(project, draftId), (old) => (old ? { ...old, body: v.text, hash: null, note: "Saved to Mail. Reading it back before it can be checked.", checkedCurrent: false } : old)),
  });
  const restore = useCommand({ project, touches: DRAFT_MAIL, run: (_: void) => sendApi.restore(project, draftId) });
  return { save, restore };
}

/** The send dialog's fix: move the Hub's leftover drafts of this one to Mail's Trash (never the owner's own drafts). */
export const useTidyMail = (project: string, draftId: number, on: { onSuccess: (r: Awaited<ReturnType<typeof sendApi.tidy>>) => void; onError: (e: unknown) => void }) =>
  useCommand({ project, touches: ["mail"], run: (_: void) => sendApi.tidy(project, draftId), onSuccess: on.onSuccess, onError: on.onError });

// ---- The send (decision 0011: one door, the owner's click)

/**
 * A mail send through the one door (`send-door.ts`): after the person confirmed in the review dialog (P105), the dry run reads the
 * draft from Mail (it sends nothing) and the apply sends exactly that, when it is what the dialog showed.
 */
export function useSendFlow(project: string, draftId: number) {
  const refresh = useRefreshTopics(project);
  return useSendDoor<SendPreviewDto>({
    preview: () => sendApi.preview(project, draftId),
    send: (mail) => sendApi.send(project, draftId, { to: mail.to, subject: mail.subject }),
    settle: () => refresh(SEND),
  });
}

/** Cancel of the card's queued send (the delay before it leaves); the card reads Mail again. */
export const useCancelQueued = (project: string, sendId: number | null, on: { onSuccess: () => void; onError: (e: unknown) => void }) =>
  useCommand({ project, touches: SEND, run: (_: void) => (sendId !== null ? sendApi.cancel(project, sendId) : Promise.reject(new Error("Nothing is queued."))), onSuccess: on.onSuccess, onError: on.onError });

// ---- Send all Checked of a batch (P85b: dry run, the owner's confirm, then exactly the dry run's drafts)

/** How often the panel reads a running batch's progress. */
export const BATCH_RUN_POLL_MS = 2000;

/** The run of Send all Checked of one batch (in the server's memory), read while it runs. */
export const useBatchRun = (project: string, batchId: number) =>
  useQuery({ queryKey: keys.batchRun(project, batchId), queryFn: () => batchSendApi.run(project, batchId), refetchInterval: (q) => (q.state.data?.run?.state === "running" ? BATCH_RUN_POLL_MS : false) });

/**
 * The batch's three steps: the dry run (`plan`, it sends nothing), the apply with exactly the dry run's drafts and hashes (`start`)
 * and Stop. The run's answer replaces the polled one at once. `moved()` reads the drafts, the history and Mail again when the run
 * moves on (P87 B4: with the Mail reads, so a sent card reads Mail again instead of showing its draft as deleted).
 */
export function useBatchSend(project: string, batchId: number, on: { onMutate: () => void; onPlan: (p: BatchSendPlanDto) => void; onStarted: () => void; onError: (e: unknown) => void }) {
  const qc = useQueryClient();
  const refresh = useRefreshTopics(project);
  const setRun = (r: { run: BatchRunDto | null }) => qc.setQueryData(keys.batchRun(project, batchId), r);
  const plan = useMutation({ mutationFn: () => batchSendApi.plan(project, batchId), onMutate: on.onMutate, onSuccess: on.onPlan, onError: on.onError });
  const start = useMutation({
    mutationFn: (p: BatchSendPlanDto) => batchSendApi.start(project, batchId, p),
    onSuccess: (r) => {
      setRun(r);
      on.onStarted();
    },
    onError: on.onError,
  });
  const stop = useMutation({ mutationFn: () => batchSendApi.stop(project, batchId), onSuccess: setRun });
  const moved = useCallback(() => refresh(SEND), [refresh]);
  return { plan, start, stop, moved };
}
