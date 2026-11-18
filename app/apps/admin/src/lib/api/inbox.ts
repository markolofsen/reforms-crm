import type { EnrollmentView, InboxFilter, InboxKind } from "@hub/config";
import { inboxDto, notByEmailDto } from "@hub/contract/responses";
import { candidatesDto, enrollmentChangedDto, enrollmentsDto, sequencesDto } from "@hub/contract/sequences";
import { read } from "./client";

/** The client lists beside the Drafts list. The triage list the agent recorded (`hub record-client`, `hub record-draft`) and the clients it did not answer by email. Read-only. */
export const inboxApi = {
  list: (project: string, filter: InboxFilter) => read(inboxDto, { method: "GET", path: "/api/inbox", query: { project, filter, limit: 50 } }),
  notByEmail: (project: string, kind: InboxKind | null) => read(notByEmailDto, { method: "GET", path: "/api/inbox/not-by-email", query: { project, ...(kind ? { kind } : {}), limit: 50 } }),
};

const base = (project: string) => `/api/projects/${encodeURIComponent(project)}`;

/**
 * Follow-ups (P47), the other client list beside the Drafts list: the project's sequences, its enrollments and the
 * candidates, and the owner's moves on them. Nothing here drafts or sends: a session drafts a due step into Mail, and the
 * owner sends it from Mail.
 */
export const sequencesApi = {
  list: (project: string) => read(sequencesDto, { method: "GET", path: `${base(project)}/sequences` }),
  enrollments: (project: string, view: EnrollmentView) => read(enrollmentsDto, { method: "GET", path: `${base(project)}/enrollments`, query: { view } }),
  candidates: (project: string) => read(candidatesDto, { method: "GET", path: `${base(project)}/enrollments/candidates` }),
  enrol: (project: string, clientId: number, sequence: string) => read(enrollmentChangedDto, { method: "POST", path: `${base(project)}/enrollments`, body: { clientId, sequence } }),
  notNow: (project: string, clientId: number, sequence: string) => read(enrollmentChangedDto, { method: "POST", path: `${base(project)}/enrollments`, body: { clientId, sequence, notNow: true } }),
  stop: (project: string, id: number) => read(enrollmentChangedDto, { method: "POST", path: `${base(project)}/enrollments/${id}/stop`, body: {} }),
};
