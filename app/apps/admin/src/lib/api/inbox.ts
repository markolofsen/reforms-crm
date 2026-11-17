import type { InboxFilter, InboxKind } from "@hub/config";
import { inboxDto, notByEmailDto } from "@hub/contract/responses";
import { read } from "./client";

/** The triage list the agent recorded (`hub record-client`, `hub record-draft`) and the clients it did not answer by email. Read-only. */
export const inboxApi = {
  list: (project: string, filter: InboxFilter) => read(inboxDto, { method: "GET", path: "/api/inbox", query: { project, filter, limit: 50 } }),
  notByEmail: (project: string, kind: InboxKind | null) => read(notByEmailDto, { method: "GET", path: "/api/inbox/not-by-email", query: { project, ...(kind ? { kind } : {}), limit: 50 } }),
};
