import type { ClientFilter, Mark, SafetyKind, SettableStatus, Tone } from "@hub/config";
import type { StatusBody } from "@hub/contract/requests";
import { draftChangedDto, draftsDto, historyDto, okDto, timelineDto } from "@hub/contract/responses";
import { read } from "./client";

const draft = (id: number, action: string) => `/api/drafts/${id}/${action}`;

/** Everything a person can do to a draft and a client. None of it sends mail. */
export const reviewApi = {
  drafts: (project: string, filter: ClientFilter, offset: number) => read(draftsDto, { method: "GET", path: "/api/drafts", query: { project, filter, offset } }),
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
};
