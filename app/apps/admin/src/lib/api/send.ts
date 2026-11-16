import { doctorDto, draftMailDto, draftThreadDto, sendCancelledDto, sendPreviewDto, sendsDto, sentDto, stopDto } from "@hub/contract/responses";
import { read } from "./client";

const base = (project: string) => `/api/projects/${encodeURIComponent(project)}`;

/**
 * Sending, the history and Stop all (decision 0011). `preview` reads Mail and sends nothing; `send` carries what the
 * person saw, and the server refuses it when Mail's draft no longer matches.
 */
export const sendApi = {
  preview: (project: string, draftId: number) => read(sendPreviewDto, { method: "POST", path: `${base(project)}/drafts/${draftId}/send`, body: { apply: false } }),
  send: (project: string, draftId: number, confirm: { to: string[]; subject: string }) => read(sentDto, { method: "POST", path: `${base(project)}/drafts/${draftId}/send`, body: { apply: true, confirm } }),
  /** The draft as Mail holds it now; read-only, never stored. */
  mail: (project: string, draftId: number) => read(draftMailDto, { method: "GET", path: `${base(project)}/drafts/${draftId}/mail` }),
  /** The last five messages of the conversation, read from Mail on demand; read-only, never stored. */
  thread: (project: string, draftId: number) => read(draftThreadDto, { method: "GET", path: `${base(project)}/drafts/${draftId}/thread` }),
  list: (project: string) => read(sendsDto, { method: "GET", path: `${base(project)}/sends` }),
  cancel: (project: string, sendId: number) => read(sendCancelledDto, { method: "POST", path: `/api/sends/${sendId}/cancel`, query: { project } }),
  /** `scope` is a project slug, or `*` for every project. */
  stop: (scope: string) => read(stopDto, { method: "POST", path: `${base(scope)}/sends/stop` }),
  resume: (scope: string) => read(stopDto, { method: "POST", path: `${base(scope)}/sends/resume` }),
  doctor: (project: string) => read(doctorDto, { method: "GET", path: "/api/project/doctor", query: { project } }),
};
