import { doctorDto, draftChangedDto, draftMailDto, sendCancelledDto, sendPreviewDto, sendsDto, sendTicketDto, sentDto, stopDto } from "@hub/contract/responses";
import { read } from "./client";

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
  mail: (project: string, draftId: number) => read(draftMailDto, { method: "GET", path: `${base(project)}/drafts/${draftId}/mail` }),
  /** A person's Save (P56 S1): the whole text, written over the read whose hash it carries; Checked turns off. */
  save: (project: string, draftId: number, text: string, hash: string) => read(draftChangedDto, { method: "PUT", path: `${base(project)}/drafts/${draftId}/mail`, body: { text, hash } }),
  /** Restore (P56 S0): Mail holds no draft for it; the Hub's last copy in Trash is written again. */
  restore: (project: string, draftId: number) => read(draftChangedDto, { method: "POST", path: `${base(project)}/drafts/${draftId}/mail/restore` }),
  /** The last five messages of the conversation, read from Mail on demand; read-only, never stored. */
  list: (project: string) => read(sendsDto, { method: "GET", path: `${base(project)}/sends` }),
  cancel: (project: string, sendId: number) => read(sendCancelledDto, { method: "POST", path: `/api/sends/${sendId}/cancel`, query: { project } }),
  /** `scope` is a project slug, or `*` for every project. */
  stop: (scope: string) => read(stopDto, { method: "POST", path: `${base(scope)}/sends/stop` }),
  resume: (scope: string) => read(stopDto, { method: "POST", path: `${base(scope)}/sends/resume` }),
  doctor: (project: string) => read(doctorDto, { method: "GET", path: "/api/project/doctor", query: { project } }),
};
