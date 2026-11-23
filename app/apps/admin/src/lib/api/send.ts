import { cancelSend, createBatchSendTicket, createSendTicket, getBatchSend, getDraftMail, getProjectDoctor, listSends, restoreDraftMail, resumeSends, runBatchSend, saveDraftMail, sendOneMailDraft, stopBatchSend, stopSends, tidyDraftMail } from "@hub/api";
import { draftMailDto, mailTidyDto } from "@hub/contract/mail";
import { draftChangedDto } from "@hub/contract/review";
import { batchRunStateDto, batchSendPlanDto, doctorDto, sendCancelledDto, sendPreviewDto, sendsDto, sendTicketDto, sentDto, stopDto, type BatchSendPlanDto } from "@hub/contract/sending";
import { readGenerated } from "./client";

/**
 * Sending, the history and Stop all (decision 0011). `preview` reads Mail and sends nothing; `send` carries what the
 * person saw, and the server refuses it when Mail's draft no longer matches.
 */
export const sendApi = {
  preview: (project: string, draftId: number) => readGenerated(sendOneMailDraft(project, draftId, { apply: false }), sendPreviewDto),
  /** The apply carries a single-use ticket that only this page's own origin can mint (P49 S12), fetched just before. */
  send: async (project: string, draftId: number, confirm: { to: string[]; subject: string }) => {
    const { ticket } = await readGenerated(createSendTicket({ project, draftId }), sendTicketDto);
    return readGenerated(sendOneMailDraft(project, draftId, { apply: true, confirm, ticket }), sentDto);
  },
  /** The draft as Mail holds it now; read-only, never stored. */
  mail: (project: string, draftId: number) => readGenerated(getDraftMail(project, draftId), draftMailDto),
  /** A person's Save (P56 S1): the whole text, written over the read whose hash it carries; Checked turns off. */
  save: (project: string, draftId: number, text: string, hash: string) => readGenerated(saveDraftMail(project, draftId, { text, hash }), draftChangedDto),
  /** Restore (P56 S0): Mail holds no draft for it; the Hub's last copy in Trash is written again. */
  restore: (project: string, draftId: number) => readGenerated(restoreDraftMail(project, draftId), draftChangedDto),
  /** Tidy (P105): the Hub's own leftover drafts of the project moved to Mail's Trash (recoverable), the review dialog's fix for two drafts in Mail. */
  tidy: (project: string, draftId: number) => readGenerated(tidyDraftMail(project, draftId), mailTidyDto),
  /** The last five messages of the conversation, read from Mail on demand; read-only, never stored. */
  list: (project: string) => readGenerated(listSends(project), sendsDto),
  cancel: (project: string, sendId: number) => readGenerated(cancelSend(sendId, { project }), sendCancelledDto),
  /** `scope` is a project slug, or `*` for every project. */
  stop: (scope: string) => readGenerated(stopSends(scope), stopDto),
  resume: (scope: string) => readGenerated(resumeSends(scope), stopDto),
  doctor: (project: string) => readGenerated(getProjectDoctor({ project }), doctorDto),
};

/**
 * Send all Checked of one batch (P85b, decision 0011 amendment of 2026-11-20 point 4). `plan` reads every Checked draft of the batch
 * from Mail through the send door's checks and sends nothing; `start` carries exactly the drafts and text hashes the person
 * confirmed, with a ticket minted for that list just before; the server then sends them one at a time, spaced, and `run` reads its
 * progress; `stop` leaves the drafts not yet tried.
 */
export const batchSendApi = {
  plan: (project: string, batchId: number) => readGenerated(runBatchSend(project, batchId, { apply: false }), batchSendPlanDto),
  start: async (project: string, batchId: number, plan: BatchSendPlanDto) => {
    const items = plan.items.map((i) => ({ draftId: i.draftId, hash: i.hash }));
    const { ticket } = await readGenerated(createBatchSendTicket({ project, batchId, items }), sendTicketDto);
    // The server answers a started run with 202 (Accepted: it sends in the background), never 200.
    return readGenerated(runBatchSend(project, batchId, { apply: true, items, ticket }), batchRunStateDto, [202]);
  },
  run: (project: string, batchId: number) => readGenerated(getBatchSend(project, batchId), batchRunStateDto),
  stop: (project: string, batchId: number) => readGenerated(stopBatchSend(project, batchId), batchRunStateDto),
};
