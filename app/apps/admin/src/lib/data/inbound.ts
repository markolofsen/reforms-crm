"use client";

import { keepPreviousData, useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { EnrollmentView, InboxKind } from "@hub/config";
import type { LeadActionDto, LeadView } from "@hub/contract/inbound";
import type { LiveTopic } from "@hub/contract/live";
import { inboundApi, inboxApi, leadsApi, sequencesApi } from "@/lib/api/inbox";
import type { LeadReviewTicketBody, LeadReviewTicketDto } from "@hub/contract/lead-pass";
import type { BatchRunDto } from "@hub/contract/sending";
import { leadPassApi, type ReviewRead } from "@/lib/api/project/lead-pass";
import { leadReviewApi } from "@/lib/api/send";
import { keys } from "@/lib/cache/keys";
import { useCommand, useRefreshTopics } from "@/lib/cache/topics";

/**
 * P127 C2's data half (V3): Mail's inbound side, one module (state rule 4b): the Mail reader's list and Check now, one inbound
 * message's No reply needed and its Undo, the Leads group and a lead's card, Not by email, and the sequence enrolments with Stop. Features
 * read and write them here and never name a key, a facade or the Query client.
 */

/** An inbound write moves the reader's rows: the Inbox list, Mail's people (Needs you), Not by email and Overview (`inbox`). */
const INBOX: readonly LiveTopic[] = ["inbox"];

/** The Mail reader's reply (P96): the people who wrote are conversations (P99); its Leads group and its counts. */
export const useInbound = (project: string) => useQuery({ queryKey: keys.inbound(project), queryFn: () => inboundApi.list(project) });

/**
 * P96 verdict 12: Check now, one read pass of the project's mailboxes (read-only toward Mail); the lists are read again after it.
 * P140 verdict 7: an open conversation too (its Mail history, the sends, the chats).
 */
const CHECKED: readonly LiveTopic[] = ["inbox", "mail", "sends", "messengers"];
export const useCheckNow = (project: string) => useCommand({ project, touches: CHECKED, run: (_: void) => inboundApi.check(project) });

/**
 * No reply needed (P96 verdict 4): their open messages leave Needs you, stored. `undo(ids)` is the toast's Undo: the same rows
 * come back and the lists are read again.
 */
export function useDismissInbound(project: string, on: { onSuccess: (r: { ids: number[] }) => void; onError: (e: unknown) => void }) {
  const refresh = useRefreshTopics(project);
  const dismiss = useCommand({ project, touches: INBOX, run: (id: number) => inboundApi.dismiss(project, id), onSuccess: on.onSuccess, onError: on.onError });
  const undo = (ids: number[]) => inboundApi.undismiss(project, ids).then(() => refresh(INBOX));
  return { dismiss, undo };
}

/** P97: one lead's card (its Notion page read now). */
export const useLead = (project: string, pageId: string) => useQuery({ queryKey: keys.lead(project, pageId), queryFn: () => leadsApi.get(project, pageId) });

/**
 * P134 verdicts 6-7: one view of Mail ▸ Leads, every lead in it (paged, no cut), the view's brands and every view's count. The
 * last list is kept while another view loads.
 */
export function useLeads(project: string | null, view: LeadView, brand: string | null) {
  const query = useInfiniteQuery({
    queryKey: keys.leads(project ?? "", view, brand),
    queryFn: ({ pageParam }) => leadsApi.list(project ?? "", view, pageParam, brand),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    placeholderData: keepPreviousData,
    enabled: project !== null,
  });
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.rows) ?? [], [query.data]);
  const head = query.data?.pages[0];
  return { query, rows, head };
}

/** The sidebar's Leads count (P134 verdict 6): New of the very query Leads' default view reads, so the two never disagree. */
export function useNewLeads(project: string | null): number {
  return useLeads(project, "new", null).head?.counts.new ?? 0;
}

export type LeadAction = "notNow" | "spam";

/**
 * Not now (local) and Spam (the lead's Status in Notion, the owner's click): the row leaves the Leads group. `undo()` is the toast's
 * Undo. The lead's own card is read again with the Inbox (its key is under no topic).
 */
export function useLeadAction(project: string, pageId: string, on: { onSuccess: (r: [LeadAction, LeadActionDto]) => void; onError: (e: unknown) => void }) {
  const qc = useQueryClient();
  const refresh = useRefreshTopics(project);
  const again = () => Promise.all([refresh(INBOX), qc.invalidateQueries({ queryKey: keys.lead(project, pageId) })]);
  const act = useCommand({
    project,
    touches: INBOX,
    run: (a: LeadAction) => (a === "spam" ? leadsApi.spam(project, pageId) : leadsApi.notNow(project, pageId)).then((r): [LeadAction, LeadActionDto] => [a, r]),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: keys.lead(project, pageId) });
      on.onSuccess(r);
    },
    onError: on.onError,
  });
  const undo = () => leadsApi.undo(project, pageId).then(again);
  return { act, undo };
}

/** Not by email (P48): the clients the agent did not answer by email, of one kind or all; the last list is kept while a kind loads. */
export const useNotByEmail = (project: string, kind: InboxKind | null, o: { keep?: boolean } = {}) =>
  useQuery({ queryKey: keys.notByEmail(project, kind), queryFn: () => inboxApi.notByEmail(project, kind), ...(o.keep ? { placeholderData: keepPreviousData } : {}) });

/** Sequence steps (P47): the project's enrolments of one view. */
export const useEnrollments = (project: string, view: EnrollmentView) => useQuery({ queryKey: keys.enrollments(project, view), queryFn: () => sequencesApi.enrollments(project, view) });

/** Stop one client's sequence (the server skips the open step in the same write). Resume is the owner's, in his terminal. */
export const useStopFollowUps = (project: string, enrollmentId: number) => useCommand({ project, touches: ["sequences"], run: (_: void) => sequencesApi.stop(project, enrollmentId) });

/** P147: the lead pass line of one project (today's decisions, the last and next pass, the review's batch). */
export const useLeadPass = (project: string) => useQuery({ queryKey: keys.leadPass(project), queryFn: () => leadPassApi.get(project) });

/** The lead pass lines of several projects, one read each (Overview and Needs you). */
export const useLeadPassOf = (projects: readonly string[]) => useQueries({ queries: projects.map((p) => ({ queryKey: keys.leadPass(p), queryFn: () => leadPassApi.get(p) })) });

/** Run lead pass now (202: the pass runs in the background; the live `inbox` topic brings its decisions). */
export const useRunLeadPass = (project: string) => useCommand({ project, touches: INBOX, run: (_: void) => leadPassApi.run(project) });
/** Run mail pass now (P147 3h): the same runner over Mail ▸ Needs you; its drafts join today's review. */
export const useRunMailPass = (project: string) => useCommand({ project, touches: INBOX, run: (_: void) => leadPassApi.run(project, "mail") });

/** Redo (verdict 3): one lead's decision cleared, so the next pass decides it again; its draft stays in Mail. */
export function useRedoLead(project: string, pageId: string, on: { onError: (e: unknown) => void } = { onError: () => undefined }) {
  const qc = useQueryClient();
  return useCommand({ project, touches: INBOX, run: (_: void) => leadPassApi.redo(project, pageId), onSuccess: () => void qc.invalidateQueries({ queryKey: keys.lead(project, pageId) }), onError: on.onError });
}

/**
 * The review of the day's lead batch: each draft's full text read from Mail now (the server keeps the hash it showed). Mounted
 * only by the open sheet and the review page; no read on window focus, since each read asks Mail for every draft.
 */
export const useLeadReview = (project: string, batchId: number | null, q: ReviewRead = {}) =>
  useQuery({ queryKey: keys.leadReview(project, batchId ?? 0, `${q.stored ? "stored" : "mail"}:${q.only?.join(",") ?? "all"}`), queryFn: () => leadPassApi.review(project, batchId ?? 0, q), staleTime: 0, refetchOnWindowFocus: false, enabled: batchId !== null && batchId > 0 });

/**
 * The review's one click: confirm (Checked on the shown text, the untick, the proposals), then the run of exactly the drafts that
 * can go out, with the ticket the confirm returned. The run's state replaces the polled one at once (Send all Checked's run).
 */
export function useConfirmLeadReview(project: string, batchId: number, on: { onDone: (t: LeadReviewTicketDto) => void; onError: (e: unknown) => void }) {
  const qc = useQueryClient();
  const refresh = useRefreshTopics(project);
  return useMutation({
    mutationFn: async (body: LeadReviewTicketBody) => {
      const t = await leadReviewApi.confirm(project, batchId, body);
      const run: { run: BatchRunDto | null } | null = t.ticket ? await leadReviewApi.start(project, batchId, t.ticket, t.items) : null;
      return { t, run };
    },
    onSuccess: ({ t, run }) => {
      if (run) qc.setQueryData(keys.batchRun(project, batchId), run);
      void refresh(["inbox", "drafts", "sends"]);
      on.onDone(t);
    },
    onError: on.onError,
  });
}
