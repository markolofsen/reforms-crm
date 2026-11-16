import type { InboxFilter } from "@hub/config";
import { inboxDto } from "@hub/contract/responses";
import { read } from "./client";

/** The triage list the agent recorded (`hub record-client`, `hub record-draft`). Read-only. */
export const inboxApi = {
  list: (project: string, filter: InboxFilter) => read(inboxDto, { method: "GET", path: "/api/inbox", query: { project, filter, limit: 50 } }),
};
