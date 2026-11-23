import { getDraftMail, getProjectDoctor, listSends } from "@hub/api";
import { draftMailDto } from "@hub/contract/mail";
import { doctorDto, draftChangedDto } from "@hub/contract/responses";
import { batchRunStateDto, batchSendPlanDto, sendCancelledDto, sendPreviewDto, sendsDto, sendTicketDto, sentDto, stopDto, type BatchSendPlanDto } from "@hub/contract/sending";
import { read, readGenerated } from "./client";

const base = (project: string) => `/api/projects/${encodeURIComponent(project)}`;

/**
 * Sending, the history and Stop all (decision 0011). `preview` reads Mail and sends nothing; `send` carries what the
 * person saw, and the server refuses it when Mail's draft no longer matches.
 */
export const sendApi = {
  preview: (project: string, draftId: number) => read(sendPreviewDto, { method: "POST", path: `${base(project)}/drafts/${draftId}/send`, body: { apply: false } }),
  /** The apply carries a single-use ticket that only this page's own origin can mint (P49 S12), fetched just before. */
  send: async (project: string, draftId: number, confirm: { to: string[]; subject: string }) => {
    const { ticket } = await read(sendTicketDto, { method: "POST", path: "/api/sends/tickets", body: { project, draftId } });
    return read(sentDto, { method: "POST", path: `${base(project)}/drafts/${draftId}/send`, body: { apply: true, confirm, ticket } });
  },
  /** The draft as Mail holds it now; read-only, never stored. */
  mail: (project: string, draftId: number) => readGenerated(getDraftMail(project, draftId), draftMailDto),
  /** A person's Save (P56 S1): the whole text, written over the read whose hash it carries; Checked turns off. */
  save: (project: string, draftId: number, text: string, hash: string) => read(draftChangedDto, { method: "PUT", path: `${base(project)}/drafts/${draftId}/mail`, body: { text, hash } }),
  /** Restore (P56 S0): Mail holds no draft for it; the Hub's last copy in Trash is written again. */
  restore: (project: string, draftId: number) => read(draftChangedDto, { method: "POST", path: `${base(project)}/drafts/${draftId}/mail/restore` }),
  /** The last five messages of the conversation, read from Mail on demand; read-only, never stored. */
  list: (project: string) => readGenerated(listSends(project), sendsDto),
  cancel: (project: string, sendId: number) => read(sendCancelledDto, { method: "POST", path: `/api/sends/${sendId}/cancel`, query: { project } }),
  /** `scope` is a project slug, or `*` for every project. */
  stop: (scope: string) => read(stopDto, { method: "POST", path: `${base(scope)}/sends/stop` }),
  resume: (scope: string) => read(stopDto, { method: "POST", path: `${base(scope)}/sends/resume` }),
  doctor: (project: string) => readGenerated(getProjectDoctor({ project }), doctorDto),
};

const batchBase = (project: string, batchId: number) => `/api/projects/${encodeURIComponent(project)}/batches/${batchId}/send`;

/**
 * Send all Checked of one batch (P85b, decision 0011 amendment of 2026-11-20 point 4). `plan` reads every Checked draft of the batch
 * from Mail through the send door's checks and sends nothing; `start` carries exactly the drafts and text hashes the person
 * confirmed, with a ticket minted for that list just before; the server then sends them one at a time, spaced, and `run` reads its
 * progress; `stop` leaves the drafts not yet tried.
 */
export const batchSendApi = {
  plan: (project: string, batchId: number) => read(batchSendPlanDto, { method: "POST", path: batchBase(project, batchId), body: { apply: false } }),
  start: async (project: string, batchId: number, plan: BatchSendPlanDto) => {
    const items = plan.items.map((i) => ({ draftId: i.draftId, hash: i.hash }));
    const { ticket } = await read(sendTicketDto, { method: "POST", path: "/api/sends/batch-tickets", body: { project, batchId, items } });
    return read(batchRunStateDto, { method: "POST", path: batchBase(project, batchId), body: { apply: true, items, ticket } });
  },
  run: (project: string, batchId: number) => read(batchRunStateDto, { method: "GET", path: batchBase(project, batchId) }),
  stop: (project: string, batchId: number) => read(batchRunStateDto, { method: "POST", path: `${batchBase(project, batchId)}/stop` }),
};
