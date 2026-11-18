import type { EnrollmentView, InboxKind } from "@hub/config";
import { notByEmailDto } from "@hub/contract/responses";
import { enrollmentChangedDto, enrollmentsDto, sequencesDto } from "@hub/contract/sequences";
import { read } from "./client";

/** The clients the agent did not answer by email (a View of Drafts, P48). Read-only. */
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
