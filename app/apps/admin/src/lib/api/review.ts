import type { ClientFilter, Mark, SafetyKind, SettableStatus, Tone } from "@hub/config";
import type { StatusBody } from "@hub/contract/requests";
import { batchesDto, draftChangedDto, draftsDto, historyDto, okDto, timelineDto, warningsAckedDto } from "@hub/contract/responses";
import { conversationDto, conversationMailDto, conversationsDto, conversationTextDto, type ConversationViewDto } from "@hub/contract/conversations";
import { read } from "./client";

const draft = (id: number, action: string) => `/api/drafts/${id}/${action}`;
const client = (project: string, id: number) => `/api/projects/${encodeURIComponent(project)}/clients/${id}/conversation`;

/** Everything a person can do to a draft and a client. None of it sends mail. */
export const reviewApi = {
  /** P99: the list of people, one row per client with its state word and its open draft; `search` narrows rows, never counts. */
  conversations: (project: string, view: ConversationViewDto, offset: number, scope: { search?: string; batch?: number | null } = {}) =>
    read(conversationsDto, { method: "GET", path: `/api/projects/${encodeURIComponent(project)}/conversations`, query: { view, offset, search: scope.search || undefined, batch: scope.batch ?? undefined } }),
  /** One conversation's header and its unsent message, from the Hub's rows (refreshed by the live topics). */
  conversation: (project: string, clientId: number) => read(conversationDto, { method: "GET", path: client(project, clientId) }),
  /** The history with this person, read from Mail now (a Mail read: on open, focus and the `mail` topic only; never stored). */
  conversationMail: (project: string, clientId: number) => read(conversationMailDto, { method: "GET", path: `${client(project, clientId)}/mail` }),
  /** One message's own words, read from Mail on demand. */
  conversationText: (project: string, clientId: number, messageId: string) => read(conversationTextDto, { method: "GET", path: `${client(project, clientId)}/text`, query: { m: messageId } }),
  /** `search` narrows the rows on the server (never the counts); `batch` limits the list to the drafts one batch wrote. */
  drafts: (project: string, filter: ClientFilter, offset: number, scope: { search?: string; batch?: number | null } = {}) =>
    read(draftsDto, { method: "GET", path: "/api/drafts", query: { project, filter, offset, search: scope.search || undefined, batch: scope.batch ?? undefined } }),
  /** `hash` is the Mail text the person read; the server refuses the tick if Mail changed since. */
  setChecked: (project: string, id: number, checked: boolean, hash?: string) => read(draftChangedDto, { method: "POST", path: draft(id, "checked"), body: { project, checked, ...(hash ? { hash } : {}) } }),
  setStatus: (project: string, id: number, status: SettableStatus, reason?: StatusBody["reason"]) =>
    read(draftChangedDto, { method: "POST", path: draft(id, "status"), body: { project, status, reason } }),
  setTone: (project: string, id: number, tone: Tone) => read(draftChangedDto, { method: "POST", path: draft(id, "tone"), body: { project, tone } }),
  ack: (project: string, id: number, kind: SafetyKind, acked: boolean) => read(draftChangedDto, { method: "POST", path: draft(id, "ack"), body: { project, kind, acked } }),
  undo: (project: string, id: number) => read(draftChangedDto, { method: "POST", path: draft(id, "undo"), query: { project } }),
  setMarks: (project: string, clientId: number, marks: Mark[]) => read(okDto, { method: "PUT", path: `/api/clients/${clientId}/marks`, body: { project, marks } }),
  timeline: (project: string, clientId: number) => read(timelineDto, { method: "GET", path: `/api/clients/${clientId}/timeline`, query: { project } }),
  history: (project: string, clientId: number) => read(historyDto, { method: "GET", path: `/api/clients/${clientId}/history`, query: { project } }),
  /** The batches of a project, read-only (P48: the builder is gone; a batch is a View of Mail), and the batch's own Undo. */
  batches: (project: string) => read(batchesDto, { method: "GET", path: "/api/batches", query: { project } }),
  undoBatch: (project: string, id: number) => read(okDto, { method: "POST", path: `/api/batches/${id}/undo`, query: { project } }),
  /** P87: every amber result of the batch's open drafts acknowledged; red ones stay one by one. */
  acknowledgeWarnings: (project: string, id: number) => read(warningsAckedDto, { method: "POST", path: `/api/batches/${id}/acknowledge-warnings`, query: { project } }),
};
