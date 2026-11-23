import type { Mark, SafetyKind, SettableStatus, Tone } from "@hub/config";
import { createManualMailDraft, getClientHistory, getClientTimeline, getConversation, getConversationMail, getConversationText, listBatches, listConversations, listDrafts, setClientMarks, type GetConversationTextParams } from "@hub/api";
import type { StatusBody } from "@hub/contract/requests";
import { batchesDto, draftChangedDto, draftsDto, historyDto, okDto, timelineDto } from "@hub/contract/review";
import { conversationDto, conversationMailDto, conversationTextDto, conversationsDto, type ConversationViewDto } from "@hub/contract/conversations";
import { read, readGenerated } from "./client";

const draft = (id: number, action: string) => `/api/drafts/${id}/${action}`;

/** Everything a person can do to a draft and a client. None of it sends mail. */
export const reviewApi = {
  /** P99: the list of people, one row per client with its state word and its open draft; `search` narrows rows, never counts. */
  conversations: (project: string, view: ConversationViewDto, offset: number, scope: { search?: string; batch?: number | null } = {}) =>
    readGenerated(listConversations(project, { view, offset, search: scope.search || undefined, batch: scope.batch ?? undefined }), conversationsDto),
  /** One conversation's header and its unsent message, from the Hub's rows (refreshed by the live topics). */
  conversation: (project: string, clientId: number) => readGenerated(getConversation(project, clientId), conversationDto),
  /** The owner's manual reply: creates one unsent Mail draft and never sends it. */
  createManualDraft: (project: string, clientId: number, text: string, brand?: string | null) => readGenerated(createManualMailDraft(project, clientId, { text, ...(brand ? { brand } : {}) }), draftChangedDto),
  /** The history with this person, read from Mail now (a Mail read: on open, focus and the `mail` topic only; never stored). */
  conversationMail: (project: string, clientId: number) => readGenerated(getConversationMail(project, clientId), conversationMailDto),
  /** One message's own words, read from Mail as its conversation bubble renders. */
  conversationText: (project: string, clientId: number, messageId: string) => readGenerated(getConversationText(project, clientId, { m: messageId } satisfies GetConversationTextParams), conversationTextDto),
  /** `search` narrows the rows on the server (never the counts); `batch` limits the list to the drafts one batch wrote. */
  drafts: (project: string, filter: Parameters<typeof listDrafts>[0]["filter"], offset: number, scope: { search?: string; batch?: number | null } = {}) =>
    readGenerated(listDrafts({ project, filter, offset, search: scope.search || undefined, batch: scope.batch ?? undefined }), draftsDto),
  /** `hash` is the Mail text the person read; the server refuses the tick if Mail changed since. */
  setChecked: (project: string, id: number, checked: boolean, hash?: string) => read(draftChangedDto, { method: "POST", path: draft(id, "checked"), body: { project, checked, ...(hash ? { hash } : {}) } }),
  setStatus: (project: string, id: number, status: SettableStatus, reason?: StatusBody["reason"]) =>
    read(draftChangedDto, { method: "POST", path: draft(id, "status"), body: { project, status, reason } }),
  setTone: (project: string, id: number, tone: Tone) => read(draftChangedDto, { method: "POST", path: draft(id, "tone"), body: { project, tone } }),
  ack: (project: string, id: number, kind: SafetyKind, acked: boolean) => read(draftChangedDto, { method: "POST", path: draft(id, "ack"), body: { project, kind, acked } }),
  undo: (project: string, id: number) => read(draftChangedDto, { method: "POST", path: draft(id, "undo"), query: { project } }),
  setMarks: (project: string, clientId: number, marks: Mark[]) => readGenerated(setClientMarks(clientId, { project, marks }), okDto),
  timeline: (project: string, clientId: number) => readGenerated(getClientTimeline(clientId, { project }), timelineDto),
  history: (project: string, clientId: number) => readGenerated(getClientHistory(clientId, { project }), historyDto),
  /** The batches of a project, read-only (P48: the builder is gone; a batch is a View of Mail), and the batch's own Undo. */
  batches: (project: string) => readGenerated(listBatches({ project }), batchesDto),
  undoBatch: (project: string, id: number) => read(okDto, { method: "POST", path: `/api/batches/${id}/undo`, query: { project } }),
};
