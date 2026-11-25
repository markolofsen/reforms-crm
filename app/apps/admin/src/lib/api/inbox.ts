import type { EnrollmentView, InboxKind } from "@hub/config";
import { checkInbound, dismissInbound, getInboundDetail, getInboundText, getLeadDetail, listEnrollments, listInbound, listLeads, listNotByEmail, listSequences, notNowLead, spamLead, stopEnrollment, undismissInbound, undoLead } from "@hub/api";
import { inboundCheckedDto, inboundDetailDto, inboundDismissedDto, inboundListDto, inboundTextDto, leadActionDto, leadDetailDto, leadsListDto, type LeadView } from "@hub/contract/inbound";
import { notByEmailDto } from "@hub/contract/inbox";
import { enrollmentChangedDto, enrollmentsDto, sequencesDto } from "@hub/contract/sequences";
import { readGenerated } from "./client";

/** The clients the agent did not answer by email (a View of Mail, P48). Read-only. */
export const inboxApi = {
  notByEmail: (project: string, kind: InboxKind | null) => readGenerated(listNotByEmail({ project, ...(kind ? { kind } : {}), limit: 50 }), notByEmailDto),
};

/**
 * Sequences (P47; the admin says "Sequence steps"), read-only but for Stop: the project's sequences and its enrolments (a session enrols on the owner's
 * phrase, D1 of P48). Nothing here drafts or sends: a session drafts a due step into Mail, and the owner sends it from Mail.
 */
export const sequencesApi = {
  list: (project: string) => readGenerated(listSequences(project), sequencesDto),
  enrollments: (project: string, view: EnrollmentView) => readGenerated(listEnrollments(project, { view }), enrollmentsDto),
  stop: (project: string, id: number) => readGenerated(stopEnrollment(project, id, {}), enrollmentChangedDto),
};

/**
 * P96 S1: the Inbox view of Mail, from the server's Mail reader (read-only toward Mail). The writes are local state only: No reply
 * needed and its Undo; Check now runs one read pass of the project's mailboxes and answers the reader's line after it.
 */
export const inboundApi = {
  list: (project: string) => readGenerated(listInbound(project), inboundListDto),
  /** The card's state from the Hub's record (open, drafts, the answering draft): refreshed by the live topics (P98). */
  get: (project: string, id: number) => readGenerated(getInboundDetail(project, id), inboundDetailDto),
  /** The client's words read from Mail now: a Mail read, on open and on focus only. */
  text: (project: string, id: number) => readGenerated(getInboundText(project, id), inboundTextDto),
  check: (project: string) => readGenerated(checkInbound(project), inboundCheckedDto),
  dismiss: (project: string, id: number) => readGenerated(dismissInbound(project, id), inboundDismissedDto),
  undismiss: (project: string, ids: number[]) => readGenerated(undismissInbound(project, { ids }), inboundDismissedDto),
};

/**
 * P97 S2 and S5: one lead of the Inbox's Leads group (read from Notion Leads), Not now (local), Spam (the lead's Status in Notion,
 * the owner's click) and their Undo. Nothing here drafts or sends: Prepare reply pastes the request into the dock.
 */
export const leadsApi = {
  /** P134: one view of Mail ▸ Leads, paged, with every view's count and the view's brands. */
  list: (project: string, view: LeadView, offset: number, brand: string | null) => readGenerated(listLeads(project, { view, offset, ...(brand ? { brand } : {}) }), leadsListDto),
  get: (project: string, pageId: string) => readGenerated(getLeadDetail(project, pageId), leadDetailDto),
  notNow: (project: string, pageId: string) => readGenerated(notNowLead(project, pageId), leadActionDto),
  spam: (project: string, pageId: string) => readGenerated(spamLead(project, pageId), leadActionDto),
  undo: (project: string, pageId: string) => readGenerated(undoLead(project, pageId), leadActionDto),
};
