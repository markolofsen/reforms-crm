import type { EnrollmentView, InboxKind } from "@hub/config";
import { inboundCheckedDto, inboundDetailDto, inboundDismissedDto, inboundListDto, inboundTextDto, leadActionDto, leadDetailDto } from "@hub/contract/inbound";
import { notByEmailDto } from "@hub/contract/responses";
import { enrollmentChangedDto, enrollmentsDto, sequencesDto } from "@hub/contract/sequences";
import { read } from "./client";

/** The clients the agent did not answer by email (a View of Mail, P48). Read-only. */
export const inboxApi = {
  notByEmail: (project: string, kind: InboxKind | null) => read(notByEmailDto, { method: "GET", path: "/api/inbox/not-by-email", query: { project, ...(kind ? { kind } : {}), limit: 50 } }),
};

const base = (project: string) => `/api/projects/${encodeURIComponent(project)}`;

/**
 * Follow-ups (P47), read-only but for Stop: the project's sequences and its enrolments (a session enrols on the owner's
 * phrase, D1 of P48). Nothing here drafts or sends: a session drafts a due step into Mail, and the owner sends it from Mail.
 */
export const sequencesApi = {
  list: (project: string) => read(sequencesDto, { method: "GET", path: `${base(project)}/sequences` }),
  enrollments: (project: string, view: EnrollmentView) => read(enrollmentsDto, { method: "GET", path: `${base(project)}/enrollments`, query: { view } }),
  stop: (project: string, id: number) => read(enrollmentChangedDto, { method: "POST", path: `${base(project)}/enrollments/${id}/stop`, body: {} }),
};

/**
 * P96 S1: the Inbox view of Mail, from the server's Mail reader (read-only toward Mail). The writes are local state only: No reply
 * needed and its Undo; Check now runs one read pass of the project's mailboxes and answers the reader's line after it.
 */
export const inboundApi = {
  list: (project: string) => read(inboundListDto, { method: "GET", path: `${base(project)}/inbound` }),
  /** The card's state from the Hub's record (open, drafts, the answering draft): refreshed by the live topics (P98). */
  get: (project: string, id: number) => read(inboundDetailDto, { method: "GET", path: `${base(project)}/inbound/${id}` }),
  /** The client's words read from Mail now: a Mail read, on open and on focus only. */
  text: (project: string, id: number) => read(inboundTextDto, { method: "GET", path: `${base(project)}/inbound/${id}/text` }),
  check: (project: string) => read(inboundCheckedDto, { method: "POST", path: `${base(project)}/inbound/check`, body: {} }),
  dismiss: (project: string, id: number) => read(inboundDismissedDto, { method: "POST", path: `${base(project)}/inbound/${id}/dismiss`, body: {} }),
  undismiss: (project: string, ids: number[]) => read(inboundDismissedDto, { method: "POST", path: `${base(project)}/inbound/undismiss`, body: { ids } }),
};

/**
 * P97 S2 and S5: one lead of the Inbox's Leads group (read from Notion Leads), Not now (local), Spam (the lead's Status in Notion,
 * the owner's click) and their Undo. Nothing here drafts or sends: Prepare reply pastes the request into the dock.
 */
export const leadsApi = {
  get: (project: string, pageId: string) => read(leadDetailDto, { method: "GET", path: `${base(project)}/leads/${pageId}` }),
  notNow: (project: string, pageId: string) => read(leadActionDto, { method: "POST", path: `${base(project)}/leads/${pageId}/not-now`, body: {} }),
  spam: (project: string, pageId: string) => read(leadActionDto, { method: "POST", path: `${base(project)}/leads/${pageId}/spam`, body: {} }),
  undo: (project: string, pageId: string) => read(leadActionDto, { method: "POST", path: `${base(project)}/leads/${pageId}/undo`, body: {} }),
};
