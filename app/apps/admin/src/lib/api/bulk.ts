import type { Audience } from "@hub/config";
import type { BatchCreateBody } from "@hub/contract/requests";
import { audienceDto, batchCreatedDto, batchDto, batchesDto, okDto } from "@hub/contract/responses";
import { read } from "./client";

/** Batches: who could get one, make one, review one. Making a batch writes drafts; nothing here sends. */
export const bulkApi = {
  audience: (project: string, audience: Audience, silentDays: number) => read(audienceDto, { method: "GET", path: "/api/bulk/audience", query: { project, audience, silentDays } }),
  create: (body: BatchCreateBody) => read(batchCreatedDto, { method: "POST", path: "/api/batches", body }),
  list: (project: string) => read(batchesDto, { method: "GET", path: "/api/batches", query: { project } }),
  /** The batch and its counts; its drafts are read through the Drafts list (`batch` filter), so one row is enough here. */
  get: (project: string, id: number) => read(batchDto, { method: "GET", path: `/api/batches/${id}`, query: { project, limit: 1 } }),
  undoLast: (project: string, id: number) => read(okDto, { method: "POST", path: `/api/batches/${id}/undo`, query: { project } }),
};
