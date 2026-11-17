import type { InboxKind } from "@hub/config";
import { notByEmailDto } from "@hub/contract/responses";
import { read } from "./client";

/** The clients the agent did not answer by email (a call, no reply needed, crossed off, unknown sender). Read-only. */
export const notByEmailApi = {
  list: (project: string, kind: InboxKind | null) => read(notByEmailDto, { method: "GET", path: "/api/inbox/not-by-email", query: { project, ...(kind ? { kind } : {}), limit: 50 } }),
};
