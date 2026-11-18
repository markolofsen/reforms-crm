import { batchesDto, okDto } from "@hub/contract/responses";
import { read } from "./client";

/** The batches of a project, read-only (P48: the builder is gone; a batch is a View of Drafts), and the batch's own Undo. */
export const bulkApi = {
  list: (project: string) => read(batchesDto, { method: "GET", path: "/api/batches", query: { project } }),
  undoLast: (project: string, id: number) => read(okDto, { method: "POST", path: `/api/batches/${id}/undo`, query: { project } }),
};
